import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getPool, endPool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

interface MigrationRecord {
  version: string;
  name: string;
  applied_at: string;
}

const migrationLockId = 1_384_717_920;
const defaultMigrationTimeoutMs = 300_000;
const defaultMigrationLockWaitTimeoutMs = 240_000;
const migrationLockRetryIntervalMs = 250;

export type MigrationStageObserver = (stage: string) => void;

export interface MigrationExecutionOptions {
  lockWaitTimeoutMs?: number;
  onStage?: MigrationStageObserver;
}

export async function migrate(
  pool?: pg.Pool,
  options: MigrationExecutionOptions = {},
): Promise<void> {
  const p = pool ?? getPool();
  const onStage = options.onStage ?? noOpMigrationStageObserver;
  onStage("connecting");
  const client = await p.connect();
  let lockAcquired = false;
  try {
    onStage("acquiring-lock");
    await acquireMigrationLock(client, options.lockWaitTimeoutMs);
    lockAcquired = true;
    onStage("reading-state");
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const available = await getAvailableMigrations();

    for (const migration of available) {
      if (applied.has(migration.version)) continue;
      onStage(`applying-${migration.version}`);
      const filePath = path.join(migrationsDir, migration.fileName);
      const sql = fs.readFileSync(filePath, "utf-8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          `INSERT INTO _migrations (version, name) VALUES ($1, $2)`,
          [migration.version, migration.name],
        );
        await client.query("COMMIT");
        console.log(`Migration applied: ${migration.version}_${migration.name}`);
      } catch (error) {
        await rollbackBestEffort(client);
        console.error(`Migration failed: ${migration.version}_${migration.name}:`, error);
        throw error;
      }
    }
  } finally {
    if (lockAcquired) {
      onStage("releasing-lock");
      await unlockBestEffort(client);
    }
    client.release();
  }
}

export async function migrateUpTo(
  pool: pg.Pool,
  targetVersion: string,
  options: MigrationExecutionOptions = {},
): Promise<void> {
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await acquireMigrationLock(client, options.lockWaitTimeoutMs);
    lockAcquired = true;
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const available = await getAvailableMigrations();

    assertTargetMigrationExists(available, targetVersion);

    for (const migration of available) {
      if (migration.version.localeCompare(targetVersion) > 0) break;
      if (applied.has(migration.version)) continue;
      const filePath = path.join(migrationsDir, migration.fileName);
      const sql = fs.readFileSync(filePath, "utf-8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          `INSERT INTO _migrations (version, name) VALUES ($1, $2)`,
          [migration.version, migration.name],
        );
        await client.query("COMMIT");
        console.log(`Migration applied: ${migration.version}_${migration.name}`);
      } catch (error) {
        await rollbackBestEffort(client);
        console.error(`Migration failed: ${migration.version}_${migration.name}:`, error);
        throw error;
      }
    }
  } finally {
    if (lockAcquired) await unlockBestEffort(client);
    client.release();
  }
}

async function acquireMigrationLock(
  client: pg.PoolClient,
  lockWaitTimeoutMs = defaultMigrationLockWaitTimeoutMs,
): Promise<void> {
  if (!Number.isSafeInteger(lockWaitTimeoutMs) || lockWaitTimeoutMs < 0) {
    throw new Error("Migration lock wait timeout must be a non-negative integer");
  }

  const deadline = Date.now() + lockWaitTimeoutMs;
  while (true) {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [migrationLockId],
    );
    if (result.rows.length === 1 && result.rows[0]?.acquired === true) return;

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`Migration advisory lock was not acquired within ${lockWaitTimeoutMs}ms`);
    }
    await delay(Math.min(migrationLockRetryIntervalMs, remainingMs));
  }
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version TEXT NOT NULL,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (version)
    )
  `);
}

async function getAppliedMigrations(client: pg.PoolClient): Promise<Map<string, MigrationRecord>> {
  const result = await client.query<MigrationRecord>(
    "SELECT version, name, applied_at FROM _migrations ORDER BY version ASC",
  );
  const map = new Map<string, MigrationRecord>();
  for (const row of result.rows) {
    map.set(row.version, row);
  }
  return map;
}

async function rollbackBestEffort(client: pg.PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {}
}

async function unlockBestEffort(client: pg.PoolClient): Promise<void> {
  try {
    await client.query("SELECT pg_advisory_unlock($1)", [migrationLockId]);
  } catch {}
}

interface AvailableMigration {
  version: string;
  name: string;
  fileName: string;
}

export interface MigrationCliDependencies {
  close(): Promise<void>;
  logger: {
    error(message: string, error: unknown): void;
    log(message: string): void;
  };
  migrate(onStage: MigrationStageObserver): Promise<void>;
  processLike: { exitCode?: string | number | null };
}

export async function executeMigrationCli(deps: MigrationCliDependencies): Promise<void> {
  let failed = false;
  try {
    await deps.migrate((stage) => deps.logger.log(`[db-migrate] ${stage}`));
    deps.logger.log("All migrations applied successfully.");
  } catch (error) {
    failed = true;
    deps.logger.error("Migration failed:", error);
  }

  try {
    deps.logger.log("[db-migrate] closing-pool");
    await deps.close();
  } catch (error) {
    failed = true;
    deps.logger.error("Migration cleanup failed:", error);
  }
  deps.processLike.exitCode = failed ? 1 : 0;
}

export function readMigrationTimeoutMs(
  env: Record<string, string | undefined> | undefined = process.env,
): number {
  const raw = env && Object.hasOwn(env, "RFQ_MIGRATION_TIMEOUT_MS")
    ? env.RFQ_MIGRATION_TIMEOUT_MS
    : undefined;
  if (raw === undefined || raw === "") return defaultMigrationTimeoutMs;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error("RFQ_MIGRATION_TIMEOUT_MS must be an integer between 1000 and 1800000");
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 1_800_000) {
    throw new Error("RFQ_MIGRATION_TIMEOUT_MS must be an integer between 1000 and 1800000");
  }
  return parsed;
}

function assertTargetMigrationExists(available: AvailableMigration[], targetVersion: string): void {
  if (!available.some((migration) => migration.version === targetVersion)) {
    throw new Error(`Target migration does not exist: ${targetVersion}`);
  }
}

async function getAvailableMigrations(): Promise<AvailableMigration[]> {
  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  const migrations: AvailableMigration[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".sql")) {
      continue;
    }

    const match = entry.name.match(/^(\d{3})[-_](.+)\.sql$/);
    if (!match) {
      continue;
    }

    migrations.push({
      version: match[1],
      name: match[2],
      fileName: entry.name,
    });
  }

  migrations.sort((a, b) => a.version.localeCompare(b.version));
  return migrations;
}

// CLI entry point
const processLike = globalThis.process;
if (processLike?.argv?.[1] && import.meta.url.endsWith(processLike.argv[1])) {
  let activeStage = "initializing";
  const timeoutMs = readMigrationTimeoutMs(processLike.env);
  const deadline = setTimeout(() => {
    console.error(`Migration exceeded ${timeoutMs}ms hard deadline during ${activeStage}`);
    processLike.exit(1);
  }, timeoutMs);
  void executeMigrationCli({
    close: endPool,
    logger: console,
    migrate: (onStage) => migrate(undefined, {
      onStage: (stage) => {
        activeStage = stage;
        onStage(stage);
      },
    }),
    processLike,
  }).finally(() => clearTimeout(deadline));
}

function noOpMigrationStageObserver(): void {}
