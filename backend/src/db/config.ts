import { isAbsolute } from "node:path";
import { requiresExplicitRuntimeConfig } from "../runtime/environment.js";

export type DatabaseSslMode = "disable" | "verify-full";

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  minPoolSize: number;
  maxPoolSize: number;
  sslMode: DatabaseSslMode;
  sslRootCertPath?: string;
}

const defaultConfig: DatabaseConfig = {
  host: "127.0.0.1",
  port: 5432,
  database: "rfq_market_maker",
  user: "rfq",
  password: "rfq",
  minPoolSize: 2,
  maxPoolSize: 10,
  sslMode: "disable",
};

const databaseUrlParameters = new Set(["maxPool", "minPool", "sslmode", "sslrootcert"]);

export function readDatabaseConfig(env: Record<string, string | undefined> | undefined = process.env): DatabaseConfig {
  const url = readOwnEnvValue(env, "DATABASE_URL");
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  if (url) {
    return parseDatabaseUrl(url, nodeEnv);
  }

  const config: DatabaseConfig = {
    host: readDbEnvValue(env, "DB_HOST", defaultConfig.host),
    port: readDbPort(env),
    database: readDbEnvValue(env, "DB_NAME", defaultConfig.database),
    user: readDbEnvValue(env, "DB_USER", defaultConfig.user),
    password: readDbEnvValue(env, "DB_PASSWORD", defaultConfig.password),
    minPoolSize: readDbSizeEnvValue(env, "DB_MIN_POOL", defaultConfig.minPoolSize),
    maxPoolSize: readDbSizeEnvValue(env, "DB_MAX_POOL", defaultConfig.maxPoolSize),
    sslMode: "disable",
  };
  assertDatabaseTransportSecurity(config, nodeEnv);
  return config;
}

export function connectionString(config: DatabaseConfig): string {
  const url = new URL("postgres://localhost");
  url.username = config.user;
  url.password = config.password;
  url.hostname = config.host;
  url.port = String(config.port);
  url.pathname = `/${config.database}`;
  if (config.sslMode === "verify-full") {
    url.searchParams.set("sslmode", config.sslMode);
    if (config.sslRootCertPath) url.searchParams.set("sslrootcert", config.sslRootCertPath);
  }
  return url.toString();
}

export function assertDatabaseUrlForEnvironment(url: string, nodeEnv: string | undefined): void {
  parseDatabaseUrl(url, nodeEnv);
}

function parseDatabaseUrl(url: string, nodeEnv: string | undefined): DatabaseConfig {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL must be a valid postgres:// URL");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use postgres:// protocol");
  }
  if (!parsed.hostname || parsed.hash) {
    throw new Error("DATABASE_URL must include a hostname and must not include a fragment");
  }
  assertDatabaseUrlParameters(parsed.searchParams);

  const sslMode = parseSslMode(parsed.searchParams.get("sslmode"));
  const sslRootCertPath = parseSslRootCertPath(parsed.searchParams.get("sslrootcert"), sslMode);

  const config: DatabaseConfig = {
    host: parsed.hostname,
    port: parsed.port ? safeParsePort(parsed.port) : defaultConfig.port,
    database: parsed.pathname.length > 1
      ? decodeUrlComponent(parsed.pathname.slice(1), "database")
      : defaultConfig.database,
    user: decodeUrlComponent(parsed.username, "username") || defaultConfig.user,
    password: parsed.password ? decodeUrlComponent(parsed.password, "password") : defaultConfig.password,
    minPoolSize: defaultConfig.minPoolSize,
    maxPoolSize: defaultConfig.maxPoolSize,
    sslMode,
    ...(sslRootCertPath ? { sslRootCertPath } : {}),
  };

  const minPool = parsed.searchParams.get("minPool");
  const maxPool = parsed.searchParams.get("maxPool");
  if (minPool !== null) config.minPoolSize = safeParsePositiveInt(minPool, "minPool", 1, 50);
  if (maxPool !== null) config.maxPoolSize = safeParsePositiveInt(maxPool, "maxPool", 1, 100);

  assertDatabaseTransportSecurity(config, nodeEnv);
  return config;
}

function assertDatabaseUrlParameters(searchParams: URLSearchParams): void {
  for (const key of searchParams.keys()) {
    if (!databaseUrlParameters.has(key)) {
      throw new Error(`DATABASE_URL contains unsupported parameter ${key}`);
    }
    if (searchParams.getAll(key).length !== 1) {
      throw new Error(`DATABASE_URL parameter ${key} must appear exactly once`);
    }
  }
}

function parseSslMode(value: string | null): DatabaseSslMode {
  if (value === null || value === "disable") return "disable";
  if (value === "verify-full") return value;
  throw new Error("DATABASE_URL sslmode must be disable or verify-full");
}

function parseSslRootCertPath(value: string | null, sslMode: DatabaseSslMode): string | undefined {
  if (value === null) return undefined;
  if (sslMode !== "verify-full") {
    throw new Error("DATABASE_URL sslrootcert requires sslmode=verify-full");
  }
  if (!isAbsolute(value) || value.length > 4_096 || value.includes("\0")) {
    throw new Error("DATABASE_URL sslrootcert must be a bounded absolute path");
  }
  return value;
}

function assertDatabaseTransportSecurity(config: DatabaseConfig, nodeEnv: string | undefined): void {
  if (requiresExplicitRuntimeConfig(nodeEnv) && config.sslMode !== "verify-full") {
    throw new Error(`DATABASE_URL must use sslmode=verify-full when NODE_ENV=${nodeEnv}`);
  }
}

function decodeUrlComponent(value: string, field: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`DATABASE_URL ${field} must use valid percent encoding`);
  }
}

function readOwnEnvValue(env: Record<string, string | undefined> | undefined, name: string): string | undefined {
  if (!env || !Object.prototype.hasOwnProperty.call(env, name)) {
    return undefined;
  }
  return env[name];
}

function readDbEnvValue(env: Record<string, string | undefined> | undefined, name: string, fallback: string): string {
  const value = readOwnEnvValue(env, name);
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  return value.trim();
}

function readDbPort(env: Record<string, string | undefined> | undefined): number {
  const value = readOwnEnvValue(env, "DB_PORT");
  if (value === undefined || value.trim().length === 0) {
    return defaultConfig.port;
  }
  return safeParsePort(value.trim());
}

function safeParsePort(value: string): number {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`DB_PORT must be an integer between 1 and 65535, got: ${value}`);
  }
  return port;
}

function readDbSizeEnvValue(env: Record<string, string | undefined> | undefined, name: string, fallback: number): number {
  const value = readOwnEnvValue(env, name);
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  return safeParsePositiveInt(value.trim(), name, 1, 100);
}

function safeParsePositiveInt(value: string, name: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got: ${value}`);
  }
  return n;
}
