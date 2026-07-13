import { isLocalNodeEnvironment } from "../modules/signer/signer-runtime.js";

export function runtimeEnvironment(): Record<string, string | undefined> | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
}

export function readOwnEnvValue(
  env: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (!env || !Object.prototype.hasOwnProperty.call(env, name)) {
    return undefined;
  }

  return env[name];
}

export function readDecimalIntegerConfig(
  configured: string | undefined,
  options: { defaultValue: number; max: number; min: number; name: string },
): number {
  if (!configured || configured.trim().length === 0) {
    return options.defaultValue;
  }

  const normalized = configured.trim();
  if (!/^[0-9]+$/.test(normalized)) {
    throw invalidDecimalIntegerConfigError(options);
  }

  const value = Number(normalized);
  if (!Number.isSafeInteger(value) || value < options.min || value > options.max) {
    throw invalidDecimalIntegerConfigError(options);
  }

  return value;
}

export function assertIntegerOption(value: number, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }

  return value;
}

export function assertBooleanOption(value: boolean, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }

  return value;
}

export function readOptionalBoolean(value: string | undefined, defaultValue: boolean, name: string): boolean {
  if (value === undefined || value.trim().length === 0) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false`);
}

export function requiresExplicitRuntimeConfig(nodeEnv: string | undefined): boolean {
  return !isLocalNodeEnvironment(nodeEnv);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidDecimalIntegerConfigError(options: { max: number; min: number; name: string }): Error {
  return new Error(`${options.name} must be a base-10 integer between ${options.min} and ${options.max}`);
}
