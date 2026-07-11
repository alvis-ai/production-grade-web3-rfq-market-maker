import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";

export interface AnalyticsOutboxRecord {
  outboxId: string;
  topic: string;
  eventKey: string;
  eventType: string;
  schemaVersion: number;
  aggregateType: string;
  aggregateId: string;
  payload: Readonly<Record<string, unknown>>;
  attemptCount: number;
  createdAt: string;
}

export interface AnalyticsEventEnvelope {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  data: Readonly<Record<string, unknown>>;
}

const eventTypePattern = /^[a-z][a-z0-9_.-]{0,127}$/;
const aggregateTypePattern = /^[a-z][a-z0-9_-]{0,63}$/;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const topicPattern = /^[A-Za-z0-9._-]+$/;
const maxSerializedEventBytes = 1_048_576;

export function buildAnalyticsEventEnvelope(record: AnalyticsOutboxRecord): AnalyticsEventEnvelope {
  assertAnalyticsOutboxRecord(record);
  return Object.freeze({
    eventId: `ao_${record.outboxId}`,
    eventType: record.eventType,
    schemaVersion: record.schemaVersion,
    aggregateType: record.aggregateType,
    aggregateId: record.aggregateId,
    occurredAt: record.createdAt,
    data: cloneJsonObject(record.payload),
  });
}

export function serializeAnalyticsEvent(envelope: AnalyticsEventEnvelope): string {
  assertAnalyticsEventEnvelope(envelope);
  const serialized = JSON.stringify(envelope);
  if (Buffer.byteLength(serialized, "utf8") > maxSerializedEventBytes) {
    throw new Error("Analytics event exceeds the 1 MiB message limit");
  }
  return serialized;
}

export function parseAnalyticsEvent(value: Buffer | string | null): AnalyticsEventEnvelope {
  if (value === null) throw new Error("Analytics Kafka message value is required");
  const serialized = Buffer.isBuffer(value) ? value.toString("utf8") : value;
  if (Buffer.byteLength(serialized, "utf8") > maxSerializedEventBytes) {
    throw new Error("Analytics Kafka message exceeds the 1 MiB message limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Analytics Kafka message must contain valid JSON");
  }
  assertAnalyticsEventEnvelope(parsed);
  return {
    eventId: parsed.eventId,
    eventType: parsed.eventType,
    schemaVersion: parsed.schemaVersion,
    aggregateType: parsed.aggregateType,
    aggregateId: parsed.aggregateId,
    occurredAt: parsed.occurredAt,
    data: cloneJsonObject(parsed.data),
  };
}

export function assertAnalyticsOutboxRecord(value: unknown): asserts value is AnalyticsOutboxRecord {
  assertExactObject(value, [
    "outboxId",
    "topic",
    "eventKey",
    "eventType",
    "schemaVersion",
    "aggregateType",
    "aggregateId",
    "payload",
    "attemptCount",
    "createdAt",
  ], "Analytics outbox record");
  assertPositiveDecimal(value.outboxId, "Analytics outbox outboxId");
  assertPatternString(value.topic, topicPattern, 249, "Analytics outbox topic");
  assertSafeIdentifier(value.eventKey, "Analytics outbox eventKey");
  assertPatternString(value.eventType, eventTypePattern, 128, "Analytics outbox eventType");
  assertInteger(value.schemaVersion, 1, 1_000_000, "Analytics outbox schemaVersion");
  assertPatternString(value.aggregateType, aggregateTypePattern, 64, "Analytics outbox aggregateType");
  assertSafeIdentifier(value.aggregateId, "Analytics outbox aggregateId");
  if (value.eventKey !== value.aggregateId) {
    throw new Error("Analytics outbox eventKey must match aggregateId");
  }
  assertJsonObject(value.payload, "Analytics outbox payload");
  assertInteger(value.attemptCount, 0, 1_000_000, "Analytics outbox attemptCount");
  assertTimestamp(value.createdAt, "Analytics outbox createdAt");
}

export function assertAnalyticsEventEnvelope(value: unknown): asserts value is AnalyticsEventEnvelope {
  assertExactObject(value, [
    "eventId",
    "eventType",
    "schemaVersion",
    "aggregateType",
    "aggregateId",
    "occurredAt",
    "data",
  ], "Analytics event");
  if (typeof value.eventId !== "string" || !/^ao_[1-9][0-9]*$/.test(value.eventId) || value.eventId.length > 132) {
    throw new Error("Analytics event eventId is invalid");
  }
  assertPatternString(value.eventType, eventTypePattern, 128, "Analytics event eventType");
  assertInteger(value.schemaVersion, 1, 1_000_000, "Analytics event schemaVersion");
  assertPatternString(value.aggregateType, aggregateTypePattern, 64, "Analytics event aggregateType");
  assertSafeIdentifier(value.aggregateId, "Analytics event aggregateId");
  assertTimestamp(value.occurredAt, "Analytics event occurredAt");
  assertJsonObject(value.data, "Analytics event data");
}

function assertExactObject(
  value: unknown,
  fields: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const keys = Object.keys(value);
  if (keys.length !== fields.length || fields.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
    throw new Error(`${label} fields are invalid`);
  }
}

function assertJsonObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  assertJsonValue(value, label, 0, new Set());
}

function assertJsonValue(value: unknown, label: string, depth: number, seen: Set<object>): void {
  if (depth > 16) throw new Error(`${label} exceeds the maximum JSON depth`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error(`${label} numbers must be finite safe integers`);
    }
    return;
  }
  if (typeof value !== "object") throw new Error(`${label} contains a non-JSON value`);
  if (seen.has(value)) throw new Error(`${label} contains a cycle`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new Error(`${label} contains an oversized array`);
    for (const item of value) assertJsonValue(item, label, depth + 1, seen);
  } else {
    if (Object.keys(value).length > 1_000) throw new Error(`${label} contains too many fields`);
    for (const [key, item] of Object.entries(value)) {
      if (key.length === 0 || key.length > 128) throw new Error(`${label} contains an invalid field name`);
      assertJsonValue(item, label, depth + 1, seen);
    }
  }
  seen.delete(value);
}

function cloneJsonObject(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.freeze(JSON.parse(JSON.stringify(value)) as Record<string, unknown>);
}

function assertPatternString(value: unknown, pattern: RegExp, maxLength: number, label: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || !pattern.test(value)) {
    throw new Error(`${label} is invalid`);
  }
}

function assertSafeIdentifier(value: unknown, label: string): void {
  assertPatternString(value, safeIdentifierPattern, 128, label);
}

function assertPositiveDecimal(value: unknown, label: string): void {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value) || value.length > 19) {
    throw new Error(`${label} must be a positive decimal identifier`);
  }
}

function assertInteger(value: unknown, min: number, max: number, label: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be a safe integer between ${min} and ${max}`);
  }
}

function assertTimestamp(value: unknown, label: string): void {
  if (typeof value !== "string" || !isCanonicalUtcIsoTimestamp(value)) {
    throw new Error(`${label} must be a canonical UTC ISO timestamp`);
  }
}
