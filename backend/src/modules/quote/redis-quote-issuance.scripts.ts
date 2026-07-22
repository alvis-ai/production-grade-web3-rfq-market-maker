export const initializeQuoteIssuanceLedgerScript = `
local current = redis.call("GET", KEYS[1])
if not current then
  if ARGV[2] ~= "1" then return {-1, ""} end
  redis.call("SET", KEYS[1], ARGV[1], "NX")
  current = redis.call("GET", KEYS[1])
end
if current ~= ARGV[1] then return {0, current or ""} end
return {1, current}
`;

export const acquireQuoteIdempotencyScript = `
local redis_time = redis.call("TIME")
local now_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
local current_json = redis.call("GET", KEYS[1])
if current_json then
  local current = cjson.decode(current_json)
  if current.requestHash ~= ARGV[3] then return {4, current_json} end
  if current.state == "succeeded" then return {2, current_json} end
  if current.state == "failed" then return {3, current_json} end
  if current.state ~= "processing" then return {0, "invalid_state"} end
  if tonumber(current.leaseExpiresAtMs) > now_ms then return {5, current_json} end
  if current.quoteId ~= nil then return {6, current_json} end
  current.ownerToken = ARGV[4]
  current.leaseExpiresAtMs = now_ms + tonumber(ARGV[5])
  current.updatedAtMs = now_ms
  local reclaimed = cjson.encode(current)
  redis.call("SET", KEYS[1], reclaimed, "PX", ARGV[6])
  return {1, reclaimed}
end
local created = {
  schemaVersion = 1,
  principalId = ARGV[1],
  key = ARGV[2],
  requestHash = ARGV[3],
  state = "processing",
  createdAtMs = now_ms,
  updatedAtMs = now_ms,
  ownerToken = ARGV[4],
  leaseExpiresAtMs = now_ms + tonumber(ARGV[5])
}
local encoded = cjson.encode(created)
redis.call("SET", KEYS[1], encoded, "PX", ARGV[6], "NX")
return {1, encoded}
`;

export const bindQuoteIdempotencyScript = `
local current_json = redis.call("GET", KEYS[1])
if not current_json then return {0, "missing"} end
local current = cjson.decode(current_json)
if current.state ~= "processing" or current.principalId ~= ARGV[1]
   or current.requestHash ~= ARGV[2] or current.ownerToken ~= ARGV[3] then
  return {0, "ownership"}
end
if current.quoteId ~= nil and current.quoteId ~= ARGV[4] then return {0, "quote_conflict"} end
current.quoteId = ARGV[4]
current.updatedAtMs = math.max(tonumber(ARGV[5]), tonumber(current.updatedAtMs))
local encoded = cjson.encode(current)
redis.call("SET", KEYS[1], encoded, "PX", ARGV[6])
return {1, encoded}
`;

export const prepareQuoteIssuanceScript = `
local existing_json = redis.call("GET", KEYS[1])
if existing_json then
  local existing = cjson.decode(existing_json)
  if existing.quoteId ~= ARGV[1] or existing.principalId ~= ARGV[2]
     or existing.preparationHash ~= ARGV[3] then return {0, "quote_conflict", 0, ""} end
  return {2, existing.preparationHash, redis.call("XLEN", KEYS[3]), ""}
end
local backlog = redis.call("XLEN", KEYS[3])
if backlog >= tonumber(ARGV[6]) then return {0, "backlog_full", backlog, ""} end
local idempotency = nil
if ARGV[7] == "1" then
  local idem_json = redis.call("GET", KEYS[2])
  if not idem_json then return {0, "idempotency_missing", backlog, ""} end
  idempotency = cjson.decode(idem_json)
  if idempotency.state ~= "processing" or idempotency.principalId ~= ARGV[2]
     or idempotency.requestHash ~= ARGV[8] or idempotency.ownerToken ~= ARGV[9] then
    return {0, "idempotency_ownership", backlog, ""}
  end
  if idempotency.quoteId ~= nil and idempotency.quoteId ~= ARGV[1] then
    return {0, "idempotency_quote_conflict", backlog, ""}
  end
  idempotency.quoteId = ARGV[1]
  idempotency.updatedAtMs = math.max(tonumber(ARGV[5]), tonumber(idempotency.updatedAtMs))
  local updated_idem = cjson.encode(idempotency)
  redis.call("SET", KEYS[2], updated_idem, "PX", ARGV[10])
end
local quote = cjson.decode(ARGV[4])
local event = {
  schemaVersion = 1,
  eventType = "prepared",
  occurredAtMs = tonumber(ARGV[5]),
  quote = quote
}
if idempotency ~= nil then event.idempotency = idempotency end
local payload = cjson.encode(event)
redis.call("SET", KEYS[1], ARGV[4], "PX", ARGV[11], "NX")
local stream_id = redis.call(
  "XADD", KEYS[3], "*",
  "schema_version", "1",
  "event_type", "prepared",
  "payload", payload
)
return {1, ARGV[3], backlog + 1, stream_id}
`;

export const authorizeQuoteIssuanceScript = `
local current_json = redis.call("GET", KEYS[1])
if not current_json then return {0, "missing", 0, ""} end
local current = cjson.decode(current_json)
if current.quoteId ~= ARGV[1] then return {0, "quote_conflict", 0, ""} end
if current.authorization ~= nil then
  if current.authorizationHash ~= ARGV[2] then return {0, "authorization_conflict", 0, ""} end
  return {2, cjson.encode(current.authorization.record), redis.call("XLEN", KEYS[2]), ""}
end
if current.stage ~= "prepared" then return {0, "invalid_stage", 0, ""} end
local backlog = redis.call("XLEN", KEYS[2])
if backlog >= tonumber(ARGV[5]) then return {0, "backlog_full", backlog, ""} end
current.stage = "authorized"
current.authorizationHash = ARGV[2]
current.authorization = cjson.decode(ARGV[3])
current.updatedAtMs = math.max(tonumber(ARGV[4]), tonumber(current.updatedAtMs))
local updated = cjson.encode(current)
local event = {
  schemaVersion = 1,
  eventType = "authorized",
  occurredAtMs = current.updatedAtMs,
  quote = current
}
local payload = cjson.encode(event)
redis.call("SET", KEYS[1], updated, "PX", ARGV[6])
local stream_id = redis.call(
  "XADD", KEYS[2], "*",
  "schema_version", "1",
  "event_type", "authorized",
  "payload", payload
)
return {1, cjson.encode(current.authorization.record), backlog + 1, stream_id}
`;

export const admitQuoteIssuanceScript = `
local existing_json = redis.call("GET", KEYS[1])
if existing_json then
  local existing = cjson.decode(existing_json)
  if existing.quoteId ~= ARGV[1] or existing.principalId ~= ARGV[2]
     or existing.preparationHash ~= ARGV[3] or existing.authorizationHash ~= ARGV[4]
     or existing.authorization == nil then return {0, "quote_conflict", 0, ""} end
  return {2, cjson.encode(existing.authorization.record), redis.call("XLEN", KEYS[3]), ""}
end
local backlog = redis.call("XLEN", KEYS[3])
if backlog >= tonumber(ARGV[7]) then return {0, "backlog_full", backlog, ""} end
local idempotency = nil
if ARGV[8] == "1" then
  local idem_json = redis.call("GET", KEYS[2])
  if not idem_json then return {0, "idempotency_missing", backlog, ""} end
  idempotency = cjson.decode(idem_json)
  if idempotency.state ~= "processing" or idempotency.principalId ~= ARGV[2]
     or idempotency.requestHash ~= ARGV[9] or idempotency.ownerToken ~= ARGV[10] then
    return {0, "idempotency_ownership", backlog, ""}
  end
  if idempotency.quoteId ~= nil and idempotency.quoteId ~= ARGV[1] then
    return {0, "idempotency_quote_conflict", backlog, ""}
  end
end
local quote = cjson.decode(ARGV[5])
if quote.stage ~= "authorized" or quote.quoteId ~= ARGV[1] or quote.principalId ~= ARGV[2]
   or quote.preparationHash ~= ARGV[3] or quote.authorizationHash ~= ARGV[4]
   or quote.authorization == nil then return {0, "payload_conflict", backlog, ""} end
if idempotency ~= nil then
  idempotency.quoteId = ARGV[1]
  idempotency.updatedAtMs = math.max(tonumber(ARGV[6]), tonumber(idempotency.updatedAtMs))
  redis.call("SET", KEYS[2], cjson.encode(idempotency), "PX", ARGV[11])
end
local event = {
  schemaVersion = 1,
  eventType = "authorized",
  occurredAtMs = quote.updatedAtMs,
  quote = quote
}
if idempotency ~= nil then event.idempotency = idempotency end
redis.call("SET", KEYS[1], ARGV[5], "PX", ARGV[12], "NX")
local stream_id = redis.call(
  "XADD", KEYS[3], "*",
  "schema_version", "1",
  "event_type", "authorized",
  "payload", cjson.encode(event)
)
return {1, cjson.encode(quote.authorization.record), backlog + 1, stream_id}
`;

export const finalizeQuoteIssuanceScript = `
local current_json = redis.call("GET", KEYS[1])
if not current_json then return {0, "missing", 0, ""} end
local current = cjson.decode(current_json)
if current.quoteId ~= ARGV[1] or current.principalId ~= ARGV[2] then
  return {0, "quote_conflict", 0, ""}
end
if current.finalization ~= nil then
  if current.finalizationHash ~= ARGV[3] then return {0, "finalization_conflict", 0, ""} end
  return {2, current.finalizationHash, redis.call("XLEN", KEYS[4]), ""}
end
if current.stage ~= "authorized" or current.authorization.record.decision ~= "approved" then
  return {0, "invalid_stage", 0, ""}
end
local backlog = redis.call("XLEN", KEYS[4])
if backlog >= tonumber(ARGV[6]) then return {0, "backlog_full", backlog, ""} end
local idempotency = nil
if ARGV[7] == "1" then
  local idem_json = redis.call("GET", KEYS[2])
  if not idem_json then return {0, "idempotency_missing", backlog, ""} end
  idempotency = cjson.decode(idem_json)
  if idempotency.state ~= "processing" or idempotency.principalId ~= ARGV[2]
     or idempotency.requestHash ~= ARGV[8] or idempotency.ownerToken ~= ARGV[9]
     or idempotency.quoteId ~= ARGV[1] then
    return {0, "idempotency_ownership", backlog, ""}
  end
end
current.stage = "finalized"
current.finalizationHash = ARGV[3]
current.finalization = cjson.decode(ARGV[4])
current.updatedAtMs = math.max(tonumber(ARGV[5]), tonumber(current.updatedAtMs))
local updated = cjson.encode(current)
if idempotency ~= nil then
  idempotency.state = "succeeded"
  idempotency.updatedAtMs = math.max(tonumber(ARGV[5]), tonumber(idempotency.updatedAtMs))
  idempotency.ownerToken = nil
  idempotency.leaseExpiresAtMs = nil
  idempotency.response = current.finalization.response
  redis.call("SET", KEYS[2], cjson.encode(idempotency), "PX", ARGV[10])
end
local event = {
  schemaVersion = 1,
  eventType = "finalized",
  occurredAtMs = current.updatedAtMs,
  quote = current
}
if idempotency ~= nil then event.idempotency = idempotency end
local payload = cjson.encode(event)
redis.call("SET", KEYS[1], updated, "PX", ARGV[11])
redis.call("SET", KEYS[3], ARGV[1], "PX", ARGV[11])
local stream_id = redis.call(
  "XADD", KEYS[4], "*",
  "schema_version", "1",
  "event_type", "finalized",
  "payload", payload
)
return {1, ARGV[3], backlog + 1, stream_id}
`;

export const failQuoteIdempotencyScript = `
local idem_json = redis.call("GET", KEYS[1])
if not idem_json then return {0, "missing", 0, ""} end
local idempotency = cjson.decode(idem_json)
if idempotency.requestHash ~= ARGV[2] or idempotency.principalId ~= ARGV[1] then
  return {0, "ownership", 0, ""}
end
if idempotency.state == "succeeded" then return {3, idem_json, redis.call("XLEN", KEYS[3]), ""} end
if idempotency.state == "failed" then return {2, idem_json, redis.call("XLEN", KEYS[3]), ""} end
if idempotency.state ~= "processing" or idempotency.ownerToken ~= ARGV[3] then
  return {0, "ownership", 0, ""}
end
local backlog = redis.call("XLEN", KEYS[3])
if backlog >= tonumber(ARGV[6]) then return {0, "backlog_full", backlog, ""} end
idempotency.state = "failed"
idempotency.updatedAtMs = math.max(tonumber(ARGV[5]), tonumber(idempotency.updatedAtMs))
idempotency.ownerToken = nil
idempotency.leaseExpiresAtMs = nil
idempotency.error = cjson.decode(ARGV[4])
local quote = nil
if idempotency.quoteId ~= nil then
  local quote_json = redis.call("GET", KEYS[2])
  if quote_json then
    quote = cjson.decode(quote_json)
    if quote.quoteId ~= idempotency.quoteId or quote.principalId ~= idempotency.principalId then
      return {0, "quote_conflict", backlog, ""}
    end
    if quote.stage ~= "finalized" and
       (quote.authorization == nil or quote.authorization.record.decision == "approved") then
      quote.stage = "failed"
      quote.failure = idempotency.error
      quote.updatedAtMs = math.max(tonumber(ARGV[5]), tonumber(quote.updatedAtMs))
      redis.call("SET", KEYS[2], cjson.encode(quote), "PX", ARGV[8])
    end
  end
end
local updated_idem = cjson.encode(idempotency)
redis.call("SET", KEYS[1], updated_idem, "PX", ARGV[7])
local event = {
  schemaVersion = 1,
  eventType = "failed",
  occurredAtMs = idempotency.updatedAtMs,
  idempotency = idempotency
}
if quote ~= nil and quote.stage == "failed" then event.quote = quote end
local payload = cjson.encode(event)
local stream_id = redis.call(
  "XADD", KEYS[3], "*",
  "schema_version", "1",
  "event_type", "failed",
  "payload", payload
)
return {1, updated_idem, backlog + 1, stream_id}
`;

export const completeQuoteIdempotencyScript = `
local current_json = redis.call("GET", KEYS[1])
if not current_json then return {0, "missing", 0, ""} end
local current = cjson.decode(current_json)
if current.requestHash ~= ARGV[2] or current.principalId ~= ARGV[1] then
  return {0, "ownership", 0, ""}
end
if current.state == "succeeded" then return {2, current_json, redis.call("XLEN", KEYS[2]), ""} end
if current.state ~= "processing" or current.ownerToken ~= ARGV[3]
   or current.quoteId ~= ARGV[4] then return {0, "ownership", 0, ""} end
local backlog = redis.call("XLEN", KEYS[2])
if backlog >= tonumber(ARGV[7]) then return {0, "backlog_full", backlog, ""} end
current.state = "succeeded"
current.updatedAtMs = math.max(tonumber(ARGV[6]), tonumber(current.updatedAtMs))
current.ownerToken = nil
current.leaseExpiresAtMs = nil
current.response = cjson.decode(ARGV[5])
local updated = cjson.encode(current)
redis.call("SET", KEYS[1], updated, "PX", ARGV[8])
local event = {
  schemaVersion = 1,
  eventType = "finalized",
  occurredAtMs = current.updatedAtMs,
  idempotency = current
}
local stream_id = redis.call(
  "XADD", KEYS[2], "*",
  "schema_version", "1",
  "event_type", "finalized",
  "payload", cjson.encode(event)
)
return {1, updated, backlog + 1, stream_id}
`;

export const markQuoteIssuanceProjectedScript = `
local ranks = {prepared = 1, authorized = 2, failed = 3, finalized = 4}
local current = redis.call("GET", KEYS[1])
if current and ranks[current] ~= nil and ranks[current] > ranks[ARGV[1]] then return current end
redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2])
return ARGV[1]
`;
