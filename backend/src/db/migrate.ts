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

export async function migrate(pool?: pg.Pool): Promise<void> {
  const p = pool ?? getPool();
  const client = await p.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [migrationLockId]);
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const available = await getAvailableMigrations();

    for (const migration of available) {
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
    await unlockBestEffort(client);
    client.release();
  }
}

export async function migrateUpTo(pool: pg.Pool, targetVersion: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [migrationLockId]);
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
    await unlockBestEffort(client);
    client.release();
  }
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
  migrate()
    .then(() => {
      console.log("All migrations applied successfully.");
      return endPool();
    })
    .then(() => {
      if (processLike) processLike.exitCode = 0;
    })
    .catch((error) => {
      console.error("Migration failed:", error);
      if (processLike) processLike.exitCode = 1;
    });
}
