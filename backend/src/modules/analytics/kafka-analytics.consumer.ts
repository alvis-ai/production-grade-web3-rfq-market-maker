import { Kafka, logLevel, type Consumer, type IHeaders, type SASLOptions } from "kafkajs";
import { parseAnalyticsEvent } from "./analytics-event.js";
import {
  CLICKHOUSE_ANALYTICS_MAX_BATCH_SIZE,
  type AnalyticsProjectionRow,
  type AnalyticsProjectionSink,
} from "./clickhouse-analytics.sink.js";
import {
  assertAnalyticsKafkaConfig,
  type AnalyticsKafkaConfig,
} from "./kafka-analytics.producer.js";

export interface AnalyticsKafkaConsumerConfig extends AnalyticsKafkaConfig {
  topic: string;
  groupId: string;
  sessionTimeoutMs: number;
  heartbeatIntervalMs: number;
}

export interface AnalyticsConsumerObserver {
  recordConsumed(count: number): void;
  recordConsumerError(): void;
}

interface KafkaMessageLike {
  key: Buffer | null;
  value: Buffer | null;
  offset: string;
  headers?: IHeaders;
}

interface BatchPayloadLike {
  batch: {
    topic: string;
    partition: number;
    messages: KafkaMessageLike[];
  };
  resolveOffset(offset: string): void;
  heartbeat(): Promise<void>;
  isRunning(): boolean;
  isStale(): boolean;
}

interface ConsumerLike {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(input: { topic: string; fromBeginning: boolean }): Promise<void>;
  run(input: {
    autoCommit: false;
    eachBatchAutoResolve: false;
    partitionsConsumedConcurrently: number;
    eachBatch(payload: BatchPayloadLike): Promise<void>;
  }): Promise<void>;
  commitOffsets(offsets: Array<{ topic: string; partition: number; offset: string }>): Promise<void>;
  stop(): Promise<void>;
  events?: Consumer["events"];
  on?: Consumer["on"];
}

export class KafkaAnalyticsConsumer {
  private connected = false;
  private running = false;
  private readonly consumer: ConsumerLike;
  private readonly fatalPromise: Promise<never>;
  private rejectFatal!: (error: Error) => void;
  private removeCrashListener?: () => void;

  constructor(
    private readonly config: AnalyticsKafkaConsumerConfig,
    private readonly sink: AnalyticsProjectionSink,
    private readonly observer: AnalyticsConsumerObserver = noOpObserver,
    consumer?: ConsumerLike,
  ) {
    assertAnalyticsKafkaConsumerConfig(config);
    assertSink(sink);
    assertObserver(observer);
    this.config = { ...config, brokers: [...config.brokers], ...(config.sasl ? { sasl: { ...config.sasl } } : {}) };
    this.consumer = consumer ?? createConsumer(this.config);
    assertConsumer(this.consumer);
    this.fatalPromise = new Promise<never>((_resolve, reject) => {
      this.rejectFatal = reject;
    });
    void this.fatalPromise.catch(() => {});
    if (this.consumer.events?.CRASH && this.consumer.on) {
      this.removeCrashListener = this.consumer.on(this.consumer.events.CRASH, (event) => {
        const error = event.payload?.error instanceof Error
          ? event.payload.error
          : new Error("Analytics Kafka consumer crashed");
        this.observer.recordConsumerError();
        if (event.payload?.restart !== true) {
          this.running = false;
          this.rejectFatal(error);
        }
      });
    }
  }

  async connect(): Promise<void> {
    await this.consumer.connect();
    this.connected = true;
    await this.consumer.subscribe({ topic: this.config.topic, fromBeginning: true });
  }

  async run(): Promise<void> {
    if (!this.connected) throw new Error("Analytics Kafka consumer is not connected");
    this.running = true;
    try {
      await this.consumer.run({
        autoCommit: false,
        eachBatchAutoResolve: false,
        partitionsConsumedConcurrently: 3,
        eachBatch: async (payload) => this.consumeBatch(payload),
      });
    } catch (error) {
      this.running = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.consumer.stop();
  }

  async disconnect(): Promise<void> {
    try {
      await this.consumer.disconnect();
    } finally {
      this.removeCrashListener?.();
      this.removeCrashListener = undefined;
      this.connected = false;
      this.running = false;
    }
  }

  isReady(): boolean {
    return this.connected && this.running;
  }

  waitForFatal(): Promise<never> {
    return this.fatalPromise;
  }

  private async consumeBatch(payload: BatchPayloadLike): Promise<void> {
    if (!payload.isRunning() || payload.isStale() || payload.batch.messages.length === 0) return;
    try {
      const rows = payload.batch.messages.map((message) => projectionRow(payload.batch, message));
      for (let start = 0; start < rows.length; start += CLICKHOUSE_ANALYTICS_MAX_BATCH_SIZE) {
        await this.sink.insertBatch(rows.slice(start, start + CLICKHOUSE_ANALYTICS_MAX_BATCH_SIZE));
        if (start + CLICKHOUSE_ANALYTICS_MAX_BATCH_SIZE < rows.length) await payload.heartbeat();
      }
      if (!payload.isRunning() || payload.isStale()) return;
      for (const message of payload.batch.messages) payload.resolveOffset(message.offset);
      const lastOffset = payload.batch.messages.at(-1)!.offset;
      await this.consumer.commitOffsets([{
        topic: payload.batch.topic,
        partition: payload.batch.partition,
        offset: nextOffset(lastOffset),
      }]);
      await payload.heartbeat();
      this.observer.recordConsumed(rows.length);
    } catch (error) {
      this.observer.recordConsumerError();
      throw error;
    }
  }
}

function projectionRow(
  batch: BatchPayloadLike["batch"],
  message: KafkaMessageLike,
): AnalyticsProjectionRow {
  const envelope = parseAnalyticsEvent(message.value);
  const key = message.key?.toString("utf8");
  if (key !== envelope.aggregateId) throw new Error("Analytics Kafka key does not match aggregateId");
  assertHeaders(message.headers, envelope);
  if (!/^(0|[1-9][0-9]*)$/.test(message.offset)) throw new Error("Analytics Kafka offset is invalid");
  return {
    envelope,
    kafkaTopic: batch.topic,
    kafkaPartition: batch.partition,
    kafkaOffset: message.offset,
  };
}

function assertHeaders(headers: IHeaders | undefined, envelope: ReturnType<typeof parseAnalyticsEvent>): void {
  if (!headers) throw new Error("Analytics Kafka headers are required");
  const eventId = singleHeader(headers["event-id"], "event-id");
  const eventType = singleHeader(headers["event-type"], "event-type");
  const schemaVersion = singleHeader(headers["schema-version"], "schema-version");
  if (eventId !== envelope.eventId || eventType !== envelope.eventType || schemaVersion !== String(envelope.schemaVersion)) {
    throw new Error("Analytics Kafka headers do not match the event envelope");
  }
}

function singleHeader(value: Buffer | string | Array<Buffer | string> | undefined, field: string): string {
  if (value === undefined || Array.isArray(value)) throw new Error(`Analytics Kafka ${field} header is invalid`);
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}

function nextOffset(value: string): string {
  try {
    return (BigInt(value) + 1n).toString();
  } catch {
    throw new Error("Analytics Kafka offset is invalid");
  }
}

function createConsumer(config: AnalyticsKafkaConsumerConfig): Consumer {
  const kafka = new Kafka({
    brokers: [...config.brokers],
    clientId: `${config.clientId}-consumer`,
    ssl: config.ssl,
    ...(config.sasl ? { sasl: config.sasl as SASLOptions } : {}),
    connectionTimeout: config.connectionTimeoutMs,
    requestTimeout: config.requestTimeoutMs,
    enforceRequestTimeout: true,
    logLevel: logLevel.NOTHING,
    retry: { retries: 8 },
  });
  return kafka.consumer({
    groupId: config.groupId,
    sessionTimeout: config.sessionTimeoutMs,
    heartbeatInterval: config.heartbeatIntervalMs,
    allowAutoTopicCreation: false,
    readUncommitted: false,
  });
}

export function assertAnalyticsKafkaConsumerConfig(value: unknown): asserts value is AnalyticsKafkaConsumerConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Analytics consumer config must be an object");
  }
  const record = value as Record<string, unknown>;
  const fields = [
    "brokers",
    "clientId",
    "ssl",
    "sasl",
    "connectionTimeoutMs",
    "requestTimeoutMs",
    "topic",
    "groupId",
    "sessionTimeoutMs",
    "heartbeatIntervalMs",
  ];
  const required = fields.filter((field) => field !== "sasl");
  if (Object.keys(record).some((field) => !fields.includes(field)) ||
      required.some((field) => !Object.hasOwn(record, field))) {
    throw new Error("Analytics consumer config fields are invalid");
  }
  assertAnalyticsKafkaConfig({
    brokers: record.brokers,
    clientId: record.clientId,
    ssl: record.ssl,
    ...(record.sasl === undefined ? {} : { sasl: record.sasl }),
    connectionTimeoutMs: record.connectionTimeoutMs,
    requestTimeoutMs: record.requestTimeoutMs,
  });
  if (typeof record.topic !== "string" || record.topic.length === 0 || record.topic.length > 249 ||
      !/^[A-Za-z0-9._-]+$/.test(record.topic)) {
    throw new Error("Analytics consumer topic is invalid");
  }
  if (typeof record.groupId !== "string" || record.groupId.length === 0 || record.groupId.length > 128 ||
      !/^[A-Za-z0-9._-]+$/.test(record.groupId)) {
    throw new Error("Analytics consumer groupId is invalid");
  }
  assertInteger(record.sessionTimeoutMs, 1_000, 300_000, "sessionTimeoutMs");
  assertInteger(record.heartbeatIntervalMs, 100, 100_000, "heartbeatIntervalMs");
  if ((record.heartbeatIntervalMs as number) * 3 >= (record.sessionTimeoutMs as number)) {
    throw new Error("Analytics consumer heartbeatIntervalMs must be less than one third of sessionTimeoutMs");
  }
}

function assertInteger(value: unknown, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Analytics consumer ${field} must be between ${min} and ${max}`);
  }
}

function assertSink(value: unknown): asserts value is AnalyticsProjectionSink {
  assertMethods(value, ["initialize", "checkHealth", "insertBatch", "close"], "sink");
}

function assertObserver(value: unknown): asserts value is AnalyticsConsumerObserver {
  assertMethods(value, ["recordConsumed", "recordConsumerError"], "observer");
}

function assertConsumer(value: unknown): asserts value is ConsumerLike {
  assertMethods(value, ["connect", "disconnect", "subscribe", "run", "commitOffsets", "stop"], "consumer");
}

function assertMethods(value: unknown, methods: string[], label: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Analytics consumer ${label} must be an object`);
  }
  for (const method of methods) {
    if (typeof (value as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Analytics consumer ${label}.${method} must be a function`);
    }
  }
}

const noOpObserver: AnalyticsConsumerObserver = {
  recordConsumed() {},
  recordConsumerError() {},
};
