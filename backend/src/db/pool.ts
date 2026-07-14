import pg from "pg";
import { readDatabaseConfig, connectionString, type DatabaseConfig } from "./config.js";

const { Pool } = pg;

let pool: pg.Pool | undefined;
let currentConfig: DatabaseConfig | undefined;

export interface DatabasePoolLogger {
  error(fields: Readonly<Record<string, unknown>>, message: string): void;
}

const consolePoolLogger: DatabasePoolLogger = {
  error(fields, message) {
    console.error(message, fields);
  },
};

export function getPool(
  config?: DatabaseConfig,
  logger: DatabasePoolLogger = consolePoolLogger,
): pg.Pool {
  if (pool && config === undefined) {
    return pool;
  }

  if (pool && currentConfig && config && configsEqual(currentConfig, config)) {
    return pool;
  }

  if (pool) {
    pool.end().catch(() => {});
  }

  const resolvedConfig = config ?? readDatabaseConfig();
  currentConfig = resolvedConfig;
  pool = new Pool({
    connectionString: connectionString(resolvedConfig),
    min: resolvedConfig.minPoolSize,
    max: resolvedConfig.maxPoolSize,
  });

  pool.on("error", () => {
    logger.error({ errorCode: "DATABASE_POOL_ERROR" }, "Unexpected database pool error");
  });

  return pool;
}

export async function endPool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = undefined;
    currentConfig = undefined;
    await p.end();
  }
}

export async function checkPoolHealth(p: pg.Pool): Promise<void> {
  const client = await p.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}

function configsEqual(a: DatabaseConfig, b: DatabaseConfig): boolean {
  return (
    a.host === b.host &&
    a.port === b.port &&
    a.database === b.database &&
    a.user === b.user &&
    a.password === b.password &&
    a.minPoolSize === b.minPoolSize &&
    a.maxPoolSize === b.maxPoolSize
  );
}
