import { createClient, type ClickHouseClient, type ClickHouseSettings } from "@clickhouse/client";
import { assertAnalyticsEventEnvelope, type AnalyticsEventEnvelope } from "./analytics-event.js";

export const CLICKHOUSE_ANALYTICS_MAX_BATCH_SIZE = 500;

export interface ClickHouseAnalyticsConfig {
  url: string;
  username: string;
  password: string;
  database: string;
  table: string;
  requestTimeoutMs: number;
}

export interface AnalyticsProjectionRow {
  envelope: AnalyticsEventEnvelope;
  kafkaTopic: string;
  kafkaPartition: number;
  kafkaOffset: string;
}

export interface AnalyticsProjectionSink {
  initialize(): Promise<void>;
  checkHealth(): Promise<void>;
  insertBatch(rows: readonly AnalyticsProjectionRow[]): Promise<void>;
  close(): Promise<void>;
}

export interface ClickHouseClientLike {
  command(input: { query: string; clickhouse_settings?: ClickHouseSettings }): Promise<unknown>;
  insert(input: {
    table: string;
    values: unknown[];
    format: "JSONEachRow";
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<unknown>;
  ping(input: { select: true }): Promise<{ success: boolean; error?: Error }>;
  close(): Promise<void>;
}

export class ClickHouseAnalyticsSink implements AnalyticsProjectionSink {
  private readonly client: ClickHouseClientLike;

  constructor(
    private readonly config: ClickHouseAnalyticsConfig,
    client?: ClickHouseClientLike,
  ) {
    assertClickHouseAnalyticsConfig(config);
    this.config = { ...config };
    this.client = client ?? createClickHouseClient(config);
    assertClient(this.client);
  }

  async initialize(): Promise<void> {
    await this.client.command({
      query: `CREATE TABLE IF NOT EXISTS ${this.config.table} (
        event_id String,
        event_type LowCardinality(String),
        schema_version UInt32,
        aggregate_type LowCardinality(String),
        aggregate_id String,
        occurred_at DateTime64(3, 'UTC'),
        payload String,
        kafka_topic LowCardinality(String),
        kafka_partition UInt32,
        kafka_offset UInt64,
        ingested_at DateTime64(3, 'UTC')
      )
      ENGINE = ReplacingMergeTree(ingested_at)
      PARTITION BY toYYYYMM(occurred_at)
      ORDER BY event_id`,
      clickhouse_settings: { wait_end_of_query: 1 },
    });
  }

  async checkHealth(): Promise<void> {
    const result = await this.client.ping({ select: true });
    if (!result.success) throw result.error ?? new Error("ClickHouse analytics ping failed");
  }

  async insertBatch(rows: readonly AnalyticsProjectionRow[]): Promise<void> {
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > CLICKHOUSE_ANALYTICS_MAX_BATCH_SIZE) {
      throw new Error(
        `ClickHouse analytics batch must contain between 1 and ${CLICKHOUSE_ANALYTICS_MAX_BATCH_SIZE} rows`,
      );
    }
    const ingestedAt = clickHouseTimestamp(new Date().toISOString());
    const values = rows.map((row) => projectionValue(row, ingestedAt));
    await this.client.insert({
      table: this.config.table,
      values,
      format: "JSONEachRow",
      clickhouse_settings: {
        date_time_input_format: "best_effort",
        wait_for_async_insert: 1,
      },
    });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

function projectionValue(row: AnalyticsProjectionRow, ingestedAt: string): Record<string, unknown> {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("ClickHouse analytics projection row must be an object");
  }
  const keys = Object.keys(row);
  const fields = ["envelope", "kafkaTopic", "kafkaPartition", "kafkaOffset"];
  if (keys.length !== fields.length || fields.some((field) => !Object.hasOwn(row, field))) {
    throw new Error("ClickHouse analytics projection row fields are invalid");
  }
  if (typeof row.kafkaTopic !== "string" || row.kafkaTopic.length === 0 || row.kafkaTopic.length > 249 ||
      !/^[A-Za-z0-9._-]+$/.test(row.kafkaTopic)) {
    throw new Error("ClickHouse analytics kafkaTopic is invalid");
  }
  assertInteger(row.kafkaPartition, 0, 1_000_000, "kafkaPartition");
  if (typeof row.kafkaOffset !== "string" || !/^(0|[1-9][0-9]*)$/.test(row.kafkaOffset) || row.kafkaOffset.length > 20) {
    throw new Error("ClickHouse analytics kafkaOffset is invalid");
  }
  const envelope = row.envelope;
  assertAnalyticsEventEnvelope(envelope);
  return {
    event_id: envelope.eventId,
    event_type: envelope.eventType,
    schema_version: envelope.schemaVersion,
    aggregate_type: envelope.aggregateType,
    aggregate_id: envelope.aggregateId,
    occurred_at: clickHouseTimestamp(envelope.occurredAt),
    payload: JSON.stringify(envelope.data),
    kafka_topic: row.kafkaTopic,
    kafka_partition: row.kafkaPartition,
    kafka_offset: row.kafkaOffset,
    ingested_at: ingestedAt,
  };
}

function clickHouseTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("ClickHouse analytics timestamp must be canonical UTC ISO");
  }
  return value.slice(0, 23).replace("T", " ");
}

function createClickHouseClient(config: ClickHouseAnalyticsConfig): ClickHouseClientLike {
  const client: ClickHouseClient = createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: config.database,
    application: "rfq-analytics-worker",
    request_timeout: config.requestTimeoutMs,
    max_open_connections: 4,
    compression: { request: true, response: true },
  });
  return client;
}

export function assertClickHouseAnalyticsConfig(value: unknown): asserts value is ClickHouseAnalyticsConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("ClickHouse analytics config must be an object");
  }
  const record = value as Record<string, unknown>;
  const fields = ["url", "username", "password", "database", "table", "requestTimeoutMs"];
  if (Object.keys(record).length !== fields.length || fields.some((field) => !Object.hasOwn(record, field))) {
    throw new Error("ClickHouse analytics config fields are invalid");
  }
  normalizeUrl(record.url);
  assertCredential(record.username, "username", false);
  assertCredential(record.password, "password", true);
  assertIdentifier(record.database, "database");
  assertIdentifier(record.table, "table");
  assertInteger(record.requestTimeoutMs, 100, 120_000, "requestTimeoutMs");
}

function normalizeUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("ClickHouse analytics url must be a string");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("ClickHouse analytics url must be absolute");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password ||
      parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("ClickHouse analytics url must be an HTTP(S) origin without credentials or path");
  }
  return parsed.origin;
}

function assertCredential(value: unknown, field: string, allowEmpty: boolean): void {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > 512 || /[\r\n\0]/.test(value)) {
    throw new Error(`ClickHouse analytics ${field} is invalid`);
  }
}

function assertIdentifier(value: unknown, field: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 64 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`ClickHouse analytics ${field} is invalid`);
  }
}

function assertInteger(value: unknown, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`ClickHouse analytics ${field} must be between ${min} and ${max}`);
  }
}

function assertClient(value: unknown): asserts value is ClickHouseClientLike {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("ClickHouse analytics client dependency must be an object");
  }
  for (const method of ["command", "insert", "ping", "close"]) {
    if (typeof (value as Record<string, unknown>)[method] !== "function") {
      throw new Error(`ClickHouse analytics client.${method} must be a function`);
    }
  }
}
