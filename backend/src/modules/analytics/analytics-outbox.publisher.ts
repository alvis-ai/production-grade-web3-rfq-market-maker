import type { AnalyticsPublisherClient } from "./kafka-analytics.producer.js";
import type { AnalyticsOutboxRecord } from "./analytics-event.js";
import type { AnalyticsOutboxStore } from "./postgres-analytics-outbox.store.js";

export interface AnalyticsOutboxPublisherConfig {
  workerId: string;
  leaseMs: number;
  batchSize: number;
  pollIntervalMs: number;
  retryDelayMs: number;
  retentionMs: number;
  cleanupIntervalMs: number;
  cleanupBatchSize: number;
}

export interface AnalyticsPublishResult {
  claimed: number;
  published: number;
  retried: number;
}

export interface AnalyticsOutboxObserver {
  recordPublished(count: number): void;
  recordRetry(count: number): void;
  recordDeleted(count: number): void;
  recordIterationError(): void;
}

export interface AnalyticsPublisherLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

const maxRetryBackoffMs = 60_000;

export class AnalyticsOutboxPublisher {
  private stopped = false;
  private wakePollDelay?: () => void;

  constructor(
    private readonly store: AnalyticsOutboxStore,
    private readonly publisher: AnalyticsPublisherClient,
    private readonly config: AnalyticsOutboxPublisherConfig,
    private readonly observer: AnalyticsOutboxObserver = noOpObserver,
    private readonly logger: AnalyticsPublisherLogger = consoleLogger,
  ) {
    assertStore(store);
    assertPublisher(publisher);
    assertAnalyticsOutboxPublisherConfig(config);
    assertObserver(observer);
    assertLogger(logger);
    this.config = { ...config };
  }

  async runOnce(): Promise<AnalyticsPublishResult> {
    const records = await this.store.claimBatch(this.config.workerId, this.config.leaseMs, this.config.batchSize);
    const result = { claimed: records.length, published: 0, retried: 0 };
    for (const record of records) {
      if (this.stopped) {
        await this.release(record, "ANALYTICS_PUBLISHER_STOPPED");
        result.retried += 1;
        continue;
      }
      try {
        await this.publisher.publish(record);
        await this.store.markPublished(record.outboxId, this.config.workerId);
        result.published += 1;
      } catch {
        await this.release(record, "ANALYTICS_PUBLISH_FAILED");
        result.retried += 1;
      }
    }
    if (result.published > 0) this.observer.recordPublished(result.published);
    if (result.retried > 0) this.observer.recordRetry(result.retried);
    return result;
  }

  async run(): Promise<void> {
    this.stopped = false;
    let nextCleanupAt = Date.now();
    while (!this.stopped) {
      try {
        await this.runOnce();
        if (Date.now() >= nextCleanupAt) {
          const deleted = await this.cleanupOnce();
          if (deleted > 0) this.observer.recordDeleted(deleted);
          nextCleanupAt = Date.now() + this.config.cleanupIntervalMs;
        }
      } catch (error) {
        this.observer.recordIterationError();
        this.logger.error(
          { errorCode: analyticsIterationErrorCode(error) },
          "analytics publisher iteration failed",
        );
      }
      if (!this.stopped) await this.waitForNextPoll();
    }
  }

  stop(): void {
    this.stopped = true;
    this.wakePollDelay?.();
  }

  async cleanupOnce(nowMs: number = Date.now()): Promise<number> {
    if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error("Analytics publisher cleanup clock is invalid");
    const cutoff = new Date(nowMs - this.config.retentionMs).toISOString();
    return this.store.deletePublishedBefore(cutoff, this.config.cleanupBatchSize);
  }

  private async release(record: AnalyticsOutboxRecord, errorCode: string): Promise<void> {
    await this.store.releaseForRetry(
      record.outboxId,
      this.config.workerId,
      errorCode,
      retryBackoffMs(this.config.retryDelayMs, record.attemptCount),
    );
  }

  private async waitForNextPoll(): Promise<void> {
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        if (this.wakePollDelay === finish) this.wakePollDelay = undefined;
        resolve();
      };
      const timer = setTimeout(finish, this.config.pollIntervalMs);
      this.wakePollDelay = finish;
    });
  }
}

function retryBackoffMs(baseDelayMs: number, attemptCount: number): number {
  const exponent = Math.min(Math.max(attemptCount - 1, 0), 30);
  return Math.min(baseDelayMs * (2 ** exponent), maxRetryBackoffMs);
}

export function assertAnalyticsOutboxPublisherConfig(value: unknown): asserts value is AnalyticsOutboxPublisherConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Analytics publisher config must be an object");
  }
  const record = value as Record<string, unknown>;
  const fields = [
    "workerId",
    "leaseMs",
    "batchSize",
    "pollIntervalMs",
    "retryDelayMs",
    "retentionMs",
    "cleanupIntervalMs",
    "cleanupBatchSize",
  ];
  if (Object.keys(record).length !== fields.length || fields.some((field) => !Object.hasOwn(record, field))) {
    throw new Error("Analytics publisher config fields are invalid");
  }
  if (typeof record.workerId !== "string" || record.workerId.length === 0 || record.workerId.length > 128 ||
      !/^[A-Za-z0-9_:-]+$/.test(record.workerId)) {
    throw new Error("Analytics publisher workerId is invalid");
  }
  assertInteger(record.leaseMs, 1_000, 300_000, "leaseMs");
  assertInteger(record.batchSize, 1, 500, "batchSize");
  assertInteger(record.pollIntervalMs, 10, 60_000, "pollIntervalMs");
  assertInteger(record.retryDelayMs, 1, 3_600_000, "retryDelayMs");
  assertInteger(record.retentionMs, 3_600_000, 2_592_000_000, "retentionMs");
  assertInteger(record.cleanupIntervalMs, 1_000, 86_400_000, "cleanupIntervalMs");
  assertInteger(record.cleanupBatchSize, 1, 10_000, "cleanupBatchSize");
}

function assertInteger(value: unknown, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Analytics publisher ${field} must be between ${min} and ${max}`);
  }
}

function assertStore(value: unknown): asserts value is AnalyticsOutboxStore {
  assertMethods(value, ["checkHealth", "claimBatch", "markPublished", "releaseForRetry", "stats", "deletePublishedBefore"], "store");
}

function assertPublisher(value: unknown): asserts value is AnalyticsPublisherClient {
  assertMethods(value, ["connect", "disconnect", "publish", "isConnected"], "publisher");
}

function assertObserver(value: unknown): asserts value is AnalyticsOutboxObserver {
  assertMethods(value, ["recordPublished", "recordRetry", "recordDeleted", "recordIterationError"], "observer");
}

function assertLogger(value: unknown): asserts value is AnalyticsPublisherLogger {
  assertMethods(value, ["error"], "logger");
}

function assertMethods(value: unknown, methods: string[], label: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Analytics publisher ${label} must be an object`);
  }
  for (const method of methods) {
    if (typeof (value as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Analytics publisher ${label}.${method} must be a function`);
    }
  }
}

const noOpObserver: AnalyticsOutboxObserver = {
  recordPublished() {},
  recordRetry() {},
  recordDeleted() {},
  recordIterationError() {},
};

const consoleLogger: AnalyticsPublisherLogger = {
  error(fields, message) {
    console.error(message, fields);
  },
};

function analyticsIterationErrorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_:-]{0,127}$/.test(error.message)
    ? error.message
    : "ANALYTICS_PUBLISHER_INTERNAL";
}
