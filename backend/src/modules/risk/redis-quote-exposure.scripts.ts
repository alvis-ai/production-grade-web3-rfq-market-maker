export const quoteExposureLuaHelpers = String.raw`
local function unsigned(value)
  if type(value) ~= "string" or string.match(value, "^[0-9]+$") == nil then
    error("invalid unsigned decimal")
  end
  local normalized = string.gsub(value, "^0+", "")
  if normalized == "" then return "0" end
  return normalized
end

local function compare_unsigned(left, right)
  left = unsigned(left)
  right = unsigned(right)
  if string.len(left) < string.len(right) then return -1 end
  if string.len(left) > string.len(right) then return 1 end
  if left < right then return -1 end
  if left > right then return 1 end
  return 0
end

local function add_unsigned(left, right)
  left = unsigned(left)
  right = unsigned(right)
  local carry = 0
  local output = ""
  local left_index = string.len(left)
  local right_index = string.len(right)
  while left_index > 0 or right_index > 0 or carry > 0 do
    local left_digit = left_index > 0 and tonumber(string.sub(left, left_index, left_index)) or 0
    local right_digit = right_index > 0 and tonumber(string.sub(right, right_index, right_index)) or 0
    local sum = left_digit + right_digit + carry
    output = tostring(sum % 10) .. output
    carry = math.floor(sum / 10)
    left_index = left_index - 1
    right_index = right_index - 1
  end
  return unsigned(output)
end

local function subtract_unsigned(left, right)
  left = unsigned(left)
  right = unsigned(right)
  if compare_unsigned(left, right) < 0 then error("unsigned subtraction underflow") end
  local borrow = 0
  local output = ""
  local left_index = string.len(left)
  local right_index = string.len(right)
  while left_index > 0 do
    local left_digit = tonumber(string.sub(left, left_index, left_index)) - borrow
    local right_digit = right_index > 0 and tonumber(string.sub(right, right_index, right_index)) or 0
    if left_digit < right_digit then
      left_digit = left_digit + 10
      borrow = 1
    else
      borrow = 0
    end
    output = tostring(left_digit - right_digit) .. output
    left_index = left_index - 1
    right_index = right_index - 1
  end
  if borrow ~= 0 then error("unsigned subtraction underflow") end
  return unsigned(output)
end

local function split_signed(value)
  if type(value) ~= "string" then error("invalid signed decimal") end
  if string.sub(value, 1, 1) == "-" then
    local magnitude = unsigned(string.sub(value, 2))
    return magnitude == "0" and 1 or -1, magnitude
  end
  return 1, unsigned(value)
end

local function add_signed(left, right)
  local left_sign, left_magnitude = split_signed(left)
  local right_sign, right_magnitude = split_signed(right)
  if left_sign == right_sign then
    local magnitude = add_unsigned(left_magnitude, right_magnitude)
    return left_sign < 0 and magnitude ~= "0" and "-" .. magnitude or magnitude
  end
  local comparison = compare_unsigned(left_magnitude, right_magnitude)
  if comparison == 0 then return "0" end
  if comparison > 0 then
    local magnitude = subtract_unsigned(left_magnitude, right_magnitude)
    return left_sign < 0 and "-" .. magnitude or magnitude
  end
  local magnitude = subtract_unsigned(right_magnitude, left_magnitude)
  return right_sign < 0 and "-" .. magnitude or magnitude
end

local function set_unsigned_total(key, field, current, delta, subtract)
  local next_value = subtract and subtract_unsigned(current, delta) or add_unsigned(current, delta)
  if next_value == "0" then
    redis.call("HDEL", key, field)
  else
    redis.call("HSET", key, field, next_value)
  end
  return next_value
end

local function set_signed_total(key, field, delta)
  local next_value = add_signed(redis.call("HGET", key, field) or "0", delta)
  if next_value == "0" then
    redis.call("HDEL", key, field)
  else
    redis.call("HSET", key, field, next_value)
  end
  return next_value
end

local function user_field(record)
  return tostring(record.chainId) .. ":" .. record.user
end

local function pair_field(record)
  return tostring(record.chainId) .. ":" .. record.tokenLow .. ":" .. record.tokenHigh
end

local function output_field(record)
  return tostring(record.chainId) .. ":" .. record.tokenOut
end

local function token_field(record, token)
  return tostring(record.chainId) .. ":" .. token
end

local function remove_record(payload)
  local record = cjson.decode(payload)
  set_unsigned_total(KEYS[3], user_field(record), redis.call("HGET", KEYS[3], user_field(record)) or "0", record.notionalUsdE18, true)
  set_unsigned_total(KEYS[4], pair_field(record), redis.call("HGET", KEYS[4], pair_field(record)) or "0", record.notionalUsdE18, true)
  set_unsigned_total(KEYS[5], output_field(record), redis.call("HGET", KEYS[5], output_field(record)) or "0", record.amountOut, true)
  set_signed_total(KEYS[6], token_field(record, record.tokenIn), "-" .. record.amountIn)
  set_signed_total(KEYS[6], token_field(record, record.tokenOut), record.amountOut)
  redis.call("HDEL", KEYS[1], record.quoteId)
  redis.call("ZREM", KEYS[2], record.quoteId)
  redis.call("HINCRBY", KEYS[9], tostring(record.chainId), 1)
  return record
end

local function clean_expired(now_seconds, cleanup_limit)
  local expired = redis.call("ZRANGEBYSCORE", KEYS[2], "-inf", now_seconds, "LIMIT", 0, cleanup_limit)
  for _, quote_id in ipairs(expired) do
    local payload = redis.call("HGET", KEYS[1], quote_id)
    if payload then
      remove_record(payload)
    else
      redis.call("ZREM", KEYS[2], quote_id)
    end
  end
  return redis.call("ZCOUNT", KEYS[2], "-inf", now_seconds)
end
`;

export const initializeQuoteExposureLedgerScript = String.raw`
local current = redis.call("GET", KEYS[1])
if current then
  if current == ARGV[1] then return {1, current} end
  return {0, current}
end
if ARGV[2] ~= "1" then return {-1, ""} end
redis.call("SET", KEYS[1], ARGV[1], "NX")
current = redis.call("GET", KEYS[1])
if current == ARGV[1] then return {1, current} end
return {0, current or ""}
`;

export const acquireQuoteExposureLockScript = String.raw`
local acquired = redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2], "NX")
if acquired then return 1 end
return 0
`;

export const readVersionedQuoteExposureStateScript = `${quoteExposureLuaHelpers}${String.raw`
local redis_time = redis.call("TIME")
local remaining_expired = clean_expired(tonumber(redis_time[1]), tonumber(ARGV[1]))
if remaining_expired > 0 then return {-1, tostring(remaining_expired)} end
local existing = redis.call("HGET", KEYS[1], ARGV[2]) or ""
local output = {
  1,
  existing,
  redis.call("XLEN", KEYS[7]),
  redis.call("HGET", KEYS[9], ARGV[3]) or "0"
}
local asset_count = tonumber(ARGV[4])
for index = 1, asset_count do
  table.insert(output, redis.call("HGET", KEYS[6], ARGV[4 + index]) or "0")
end
return output
`}`;

export const releaseQuoteExposureLockScript = String.raw`
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export const getQuoteExposureReservationScript = String.raw`
return redis.call("HGET", KEYS[1], ARGV[1]) or ""
`;

export const quoteExposureReservationLuaFunctions = String.raw`
local function prepare_quote_exposure_reservation()
local redis_time = redis.call("TIME")
local remaining_expired = clean_expired(tonumber(redis_time[1]), tonumber(ARGV[10]))
local backlog = redis.call("XLEN", KEYS[7])
if remaining_expired > 0 then return {result = {4, "version_conflict", backlog}} end
local existing = redis.call("HGET", KEYS[1], ARGV[2])
if existing then return {result = {2, existing, backlog}} end
local record = cjson.decode(ARGV[3])
local current_version = redis.call("HGET", KEYS[9], tostring(record.chainId)) or "0"
if current_version ~= ARGV[1] then return {result = {4, "version_conflict", backlog}} end
local now_seconds = tonumber(redis_time[1])
if tonumber(ARGV[4]) <= now_seconds or tonumber(ARGV[5]) <= now_seconds then
  return {result = {0, "expired", backlog}}
end
if backlog >= tonumber(ARGV[9]) then return {result = {0, "backlog_full", backlog}} end

local user_key = user_field(record)
local pair_key = pair_field(record)
local output_key = output_field(record)
local next_user = add_unsigned(redis.call("HGET", KEYS[3], user_key) or "0", record.notionalUsdE18)
if compare_unsigned(next_user, ARGV[6]) > 0 then
  return {result = {3, "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED", backlog}}
end
local next_pair = add_unsigned(redis.call("HGET", KEYS[4], pair_key) or "0", record.notionalUsdE18)
if compare_unsigned(next_pair, ARGV[7]) > 0 then
  return {result = {3, "PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED", backlog}}
end
local next_output = add_unsigned(redis.call("HGET", KEYS[5], output_key) or "0", record.amountOut)
if ARGV[8] ~= "" and compare_unsigned(next_output, ARGV[8]) > 0 then
  return {result = {3, "TREASURY_LIQUIDITY_INSUFFICIENT", backlog}}
end

return {
  record = record,
  backlog = backlog,
  user_key = user_key,
  pair_key = pair_key,
  output_key = output_key,
  next_user = next_user,
  next_pair = next_pair,
  next_output = next_output
}
end

local function apply_quote_exposure_reservation(prepared)
local record = prepared.record
redis.call("HSET", KEYS[1], record.quoteId, ARGV[3])
redis.call("ZADD", KEYS[2], ARGV[5], record.quoteId)
redis.call("HSET", KEYS[3], prepared.user_key, prepared.next_user)
redis.call("HSET", KEYS[4], prepared.pair_key, prepared.next_pair)
redis.call("HSET", KEYS[5], prepared.output_key, prepared.next_output)
set_signed_total(KEYS[6], token_field(record, record.tokenIn), record.amountIn)
set_signed_total(KEYS[6], token_field(record, record.tokenOut), "-" .. record.amountOut)
redis.call("HINCRBY", KEYS[9], tostring(record.chainId), 1)
redis.call(
  "XADD", KEYS[7], "*",
  "schema_version", "1",
  "operation", "reserve",
  "payload", ARGV[3]
)
return {1, ARGV[3], prepared.backlog + 1}
end
`;

export const commitQuoteExposureReservationScript = `${quoteExposureLuaHelpers}${quoteExposureReservationLuaFunctions}${String.raw`
local prepared = prepare_quote_exposure_reservation()
if prepared.result then return prepared.result end
return apply_quote_exposure_reservation(prepared)
`}`;

export const releaseQuoteExposureReservationScript = `${quoteExposureLuaHelpers}${String.raw`
local function finish(status, value, backlog)
  if redis.call("GET", KEYS[8]) == ARGV[1] then redis.call("DEL", KEYS[8]) end
  return {status, value, backlog}
end

local backlog = redis.call("XLEN", KEYS[7])
if redis.call("GET", KEYS[8]) ~= ARGV[1] then return {0, "lock_lost", backlog} end
local payload = redis.call("HGET", KEYS[1], ARGV[2])
if not payload then return finish(2, "", backlog) end
if backlog >= tonumber(ARGV[3]) then return finish(0, "backlog_full", backlog) end
remove_record(payload)
redis.call(
  "XADD", KEYS[7], "*",
  "schema_version", "1",
  "operation", "release",
  "payload", payload
)
return finish(1, payload, backlog + 1)
`}`;
