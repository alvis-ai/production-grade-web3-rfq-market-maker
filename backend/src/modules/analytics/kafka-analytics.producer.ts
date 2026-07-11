import { Kafka, logLevel, type Producer, type SASLOptions } from "kafkajs";
import {
  buildAnalyticsEventEnvelope,
  serializeAnalyticsEvent,
  type AnalyticsOutboxRecord,
} from "./analytics-event.js";

export type AnalyticsKafkaSaslConfig =
  | { mechanism: "plain" | "scram-sha-256" | "scram-sha-512"; username: string; password: string };

export interface AnalyticsKafkaConfig {
  brokers: readonly string[];
  clientId: string;
  ssl: boolean;
  sasl?: AnalyticsKafkaSaslConfig;
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
}

export interface AnalyticsPublisherClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publish(record: AnalyticsOutboxRecord): Promise<void>;
  isConnected(): boolean;
}

interface ProducerLike {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(input: {
    topic: string;
    acks: number;
    timeout: number;
    messages: Array<{
      key: string;
      value: string;
      timestamp: string;
      headers: Record<string, string>;
    }>;
  }): Promise<unknown>;
}

export class KafkaAnalyticsProducer implements AnalyticsPublisherClient {
  private connected = false;
  private readonly producer: ProducerLike;

  constructor(
    private readonly config: AnalyticsKafkaConfig,
    producer?: ProducerLike,
  ) {
    assertAnalyticsKafkaConfig(config);
    this.config = cloneConfig(config);
    this.producer = producer ?? createProducer(this.config);
    assertProducer(this.producer);
  }

  async connect(): Promise<void> {
    await this.producer.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    try {
      await this.producer.disconnect();
    } finally {
      this.connected = false;
    }
  }

  async publish(record: AnalyticsOutboxRecord): Promise<void> {
    if (!this.connected) throw new Error("Analytics Kafka producer is not connected");
    const envelope = buildAnalyticsEventEnvelope(record);
    await this.producer.send({
      topic: record.topic,
      acks: -1,
      timeout: this.config.requestTimeoutMs,
      messages: [{
        key: record.eventKey,
        value: serializeAnalyticsEvent(envelope),
        timestamp: String(Date.parse(envelope.occurredAt)),
        headers: {
          "event-id": envelope.eventId,
          "event-type": envelope.eventType,
          "schema-version": String(envelope.schemaVersion),
        },
      }],
    });
  }

  isConnected(): boolean {
    return this.connected;
  }
}

function createProducer(config: AnalyticsKafkaConfig): Producer {
  const kafka = new Kafka({
    brokers: [...config.brokers],
    clientId: config.clientId,
    ssl: config.ssl,
    ...(config.sasl ? { sasl: config.sasl as SASLOptions } : {}),
    connectionTimeout: config.connectionTimeoutMs,
    requestTimeout: config.requestTimeoutMs,
    enforceRequestTimeout: true,
    logLevel: logLevel.NOTHING,
    retry: { retries: 8 },
  });
  return kafka.producer({
    allowAutoTopicCreation: false,
    idempotent: true,
    maxInFlightRequests: 1,
  });
}

export function assertAnalyticsKafkaConfig(value: unknown): asserts value is AnalyticsKafkaConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Analytics Kafka config must be an object");
  }
  const record = value as Record<string, unknown>;
  const fields = ["brokers", "clientId", "ssl", "sasl", "connectionTimeoutMs", "requestTimeoutMs"];
  const required = fields.filter((field) => field !== "sasl");
  if (Object.keys(record).some((field) => !fields.includes(field)) ||
      required.some((field) => !Object.prototype.hasOwnProperty.call(record, field))) {
    throw new Error("Analytics Kafka config fields are invalid");
  }
  if (!Array.isArray(record.brokers) || record.brokers.length === 0 || record.brokers.length > 32) {
    throw new Error("Analytics Kafka brokers must be a non-empty array");
  }
  for (const broker of record.brokers) assertBroker(broker);
  if (new Set(record.brokers).size !== record.brokers.length) throw new Error("Analytics Kafka brokers must be unique");
  assertSafeName(record.clientId, "clientId", 128);
  if (typeof record.ssl !== "boolean") throw new Error("Analytics Kafka ssl must be a boolean");
  if (record.sasl !== undefined) assertSaslConfig(record.sasl);
  assertInteger(record.connectionTimeoutMs, 100, 60_000, "connectionTimeoutMs");
  assertInteger(record.requestTimeoutMs, 100, 120_000, "requestTimeoutMs");
}

function assertSaslConfig(value: unknown): asserts value is AnalyticsKafkaSaslConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Analytics Kafka sasl must be an object");
  }
  const record = value as Record<string, unknown>;
  const fields = ["mechanism", "username", "password"];
  if (Object.keys(record).length !== fields.length || fields.some((field) => !Object.hasOwn(record, field))) {
    throw new Error("Analytics Kafka sasl fields are invalid");
  }
  if (record.mechanism !== "plain" && record.mechanism !== "scram-sha-256" && record.mechanism !== "scram-sha-512") {
    throw new Error("Analytics Kafka sasl mechanism is invalid");
  }
  assertCredential(record.username, "username");
  assertCredential(record.password, "password");
}

function assertBroker(value: unknown): void {
  if (typeof value !== "string" || value.length > 255 ||
      !/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\]):[1-9][0-9]{0,4}$/.test(value)) {
    throw new Error("Analytics Kafka broker must use host:port format");
  }
  const port = Number(value.slice(value.lastIndexOf(":") + 1));
  if (!Number.isInteger(port) || port > 65_535) throw new Error("Analytics Kafka broker port is invalid");
}

function assertSafeName(value: unknown, field: string, maxLength: number): void {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || !/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`Analytics Kafka ${field} is invalid`);
  }
}

function assertCredential(value: unknown, field: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || /[\r\n\0]/.test(value)) {
    throw new Error(`Analytics Kafka sasl ${field} is invalid`);
  }
}

function assertInteger(value: unknown, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Analytics Kafka ${field} must be between ${min} and ${max}`);
  }
}

function assertProducer(value: unknown): asserts value is ProducerLike {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Analytics Kafka producer dependency must be an object");
  }
  for (const method of ["connect", "disconnect", "send"]) {
    if (typeof (value as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Analytics Kafka producer.${method} must be a function`);
    }
  }
}

function cloneConfig(config: AnalyticsKafkaConfig): AnalyticsKafkaConfig {
  return {
    ...config,
    brokers: [...config.brokers],
    ...(config.sasl ? { sasl: { ...config.sasl } } : {}),
  };
}
