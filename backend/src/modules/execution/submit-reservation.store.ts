import { randomUUID } from "node:crypto";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";

export const defaultSubmitReservationLeaseMs = 900_000;
export const minSubmitReservationLeaseMs = 60_000;
export const maxSubmitReservationLeaseMs = 3_600_000;

export interface SubmitReservation {
  quoteId: string;
  ownerToken: string;
  expiresAt: string;
}

export interface SubmitReservationStore {
  acquire(quoteId: string): Promise<SubmitReservation | undefined>;
  release(reservation: SubmitReservation): Promise<void>;
  checkHealth(): Promise<void> | void;
}

export interface SubmitReservationStoreConfig {
  leaseMs: number;
}

interface SubmitReservationDependencies {
  now?: () => number;
  ownerToken?: () => string;
}

const reservationFields = ["quoteId", "ownerToken", "expiresAt"] as const;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const maxSafeIdentifierLength = 128;

export class InMemorySubmitReservationStore implements SubmitReservationStore {
  private readonly reservations = new Map<string, SubmitReservation>();
  private readonly config: SubmitReservationStoreConfig;
  private readonly now: () => number;
  private readonly ownerToken: () => string;

  constructor(
    config: SubmitReservationStoreConfig = { leaseMs: defaultSubmitReservationLeaseMs },
    dependencies: SubmitReservationDependencies = {},
  ) {
    assertSubmitReservationStoreConfig(config);
    assertDependencies(dependencies);
    this.config = { ...config };
    this.now = dependencies.now ?? Date.now;
    this.ownerToken = dependencies.ownerToken ?? (() => `submit_${randomUUID()}`);
  }

  checkHealth(): void {
    readNow(this.now);
  }

  async acquire(quoteId: string): Promise<SubmitReservation | undefined> {
    assertSafeIdentifier(quoteId, "Submit reservation quoteId");
    const nowMs = readNow(this.now);
    const current = this.reservations.get(quoteId);
    if (current && Date.parse(current.expiresAt) > nowMs) return undefined;

    const ownerToken = this.ownerToken();
    assertSafeIdentifier(ownerToken, "Submit reservation ownerToken");
    const reservation = {
      quoteId,
      ownerToken,
      expiresAt: new Date(nowMs + this.config.leaseMs).toISOString(),
    };
    this.reservations.set(quoteId, reservation);
    return { ...reservation };
  }

  async release(reservation: SubmitReservation): Promise<void> {
    assertSubmitReservation(reservation);
    const current = this.reservations.get(reservation.quoteId);
    if (current?.ownerToken === reservation.ownerToken) {
      this.reservations.delete(reservation.quoteId);
    }
  }
}

export function assertSubmitReservationStoreConfig(
  value: unknown,
): asserts value is SubmitReservationStoreConfig {
  assertRecord(value, "Submit reservation store config");
  assertExactFields(value, ["leaseMs"], "Submit reservation store config");
  if (
    typeof value.leaseMs !== "number" ||
    !Number.isSafeInteger(value.leaseMs) ||
    value.leaseMs < minSubmitReservationLeaseMs ||
    value.leaseMs > maxSubmitReservationLeaseMs
  ) {
    throw new Error(
      `Submit reservation store config.leaseMs must be an integer between ${minSubmitReservationLeaseMs} and ${maxSubmitReservationLeaseMs}`,
    );
  }
}

export function assertSubmitReservation(value: unknown): asserts value is SubmitReservation {
  assertRecord(value, "Submit reservation");
  assertExactFields(value, reservationFields, "Submit reservation");
  assertSafeIdentifier(value.quoteId, "Submit reservation quoteId");
  assertSafeIdentifier(value.ownerToken, "Submit reservation ownerToken");
  if (typeof value.expiresAt !== "string" || !isCanonicalUtcIsoTimestamp(value.expiresAt)) {
    throw new Error("Submit reservation expiresAt must be a canonical UTC timestamp");
  }
}

export function assertSubmitReservationStore(value: unknown): asserts value is SubmitReservationStore {
  assertRecord(value, "Submit reservation store");
  for (const method of ["acquire", "release", "checkHealth"] as const) {
    if (typeof value[method] !== "function") {
      throw new Error(`Submit reservation store.${method} must be a function`);
    }
  }
}

function assertDependencies(value: unknown): asserts value is SubmitReservationDependencies {
  assertRecord(value, "Submit reservation dependencies");
  assertExactFields(value, [], "Submit reservation dependencies", ["now", "ownerToken"]);
  for (const field of ["now", "ownerToken"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "function") {
      throw new Error(`Submit reservation dependencies.${field} must be a function when provided`);
    }
  }
}

function readNow(now: () => number): number {
  const value = now();
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Submit reservation clock must return a non-negative finite timestamp");
  }
  return value;
}

function assertSafeIdentifier(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxSafeIdentifierLength ||
    !safeIdentifierPattern.test(value)
  ) {
    throw new Error(`${label} must be a safe identifier no longer than ${maxSafeIdentifierLength} characters`);
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactFields(
  value: Record<string, unknown>,
  required: readonly string[],
  label: string,
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some((field) => !allowed.has(field))) {
    throw new Error(`${label} fields are invalid`);
  }
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`${label}.${field} must be an own field`);
    }
  }
  for (const field of optional) {
    if (field in value && !Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`${label}.${field} must be an own field when provided`);
    }
  }
}
