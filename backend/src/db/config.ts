export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  minPoolSize: number;
  maxPoolSize: number;
}

const defaultConfig: DatabaseConfig = {
  host: "127.0.0.1",
  port: 5432,
  database: "rfq_market_maker",
  user: "rfq",
  password: "rfq",
  minPoolSize: 2,
  maxPoolSize: 10,
};

const databaseConfigFields = ["host", "port", "database", "user", "password", "minPoolSize", "maxPoolSize"] as const;

export function readDatabaseConfig(env: Record<string, string | undefined> | undefined = process.env): DatabaseConfig {
  const url = readOwnEnvValue(env, "DATABASE_URL");
  if (url) {
    return parseDatabaseUrl(url);
  }

  return {
    host: readDbEnvValue(env, "DB_HOST", defaultConfig.host),
    port: readDbPort(env),
    database: readDbEnvValue(env, "DB_NAME", defaultConfig.database),
    user: readDbEnvValue(env, "DB_USER", defaultConfig.user),
    password: readDbEnvValue(env, "DB_PASSWORD", defaultConfig.password),
    minPoolSize: readDbSizeEnvValue(env, "DB_MIN_POOL", defaultConfig.minPoolSize),
    maxPoolSize: readDbSizeEnvValue(env, "DB_MAX_POOL", defaultConfig.maxPoolSize),
  };
}

export function connectionString(config: DatabaseConfig): string {
  return `postgres://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}`;
}

function parseDatabaseUrl(url: string): DatabaseConfig {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL must be a valid postgres:// URL");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use postgres:// protocol");
  }

  const config: DatabaseConfig = {
    host: parsed.hostname || defaultConfig.host,
    port: parsed.port ? safeParsePort(parsed.port) : defaultConfig.port,
    database: parsed.pathname.slice(1) || defaultConfig.database,
    user: decodeURIComponent(parsed.username) || defaultConfig.user,
    password: parsed.password ? decodeURIComponent(parsed.password) : defaultConfig.password,
    minPoolSize: defaultConfig.minPoolSize,
    maxPoolSize: defaultConfig.maxPoolSize,
  };

  const minPool = parsed.searchParams.get("minPool");
  const maxPool = parsed.searchParams.get("maxPool");
  if (minPool !== null) config.minPoolSize = safeParsePositiveInt(minPool, "minPool", 1, 50);
  if (maxPool !== null) config.maxPoolSize = safeParsePositiveInt(maxPool, "maxPool", 1, 100);

  return config;
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
