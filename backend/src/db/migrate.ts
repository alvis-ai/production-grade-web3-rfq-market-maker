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

export async function migrate(pool?: pg.Pool): Promise<void> {
  const p = pool ?? getPool();
  await ensureMigrationsTable(p);
  const applied = await getAppliedMigrations(p);
  const available = await getAvailableMigrations();

  for (const migration of available) {
    if (applied.has(migration.version)) {
      continue;
    }

    const filePath = path.join(migrationsDir, migration.fileName);
    const sql = fs.readFileSync(filePath, "utf-8");

    const client = await p.connect();
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
      await client.query("ROLLBACK");
      console.error(`Migration failed: ${migration.version}_${migration.name}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function migrateUpTo(pool: pg.Pool, targetVersion: string): Promise<void> {
  await ensureMigrationsTable(pool);
  const applied = await getAppliedMigrations(pool);
  const available = await getAvailableMigrations();

  for (const migration of available) {
    if (applied.has(migration.version)) {
      continue;
    }

    const filePath = path.join(migrationsDir, migration.fileName);
    const sql = fs.readFileSync(filePath, "utf-8");

    const client = await pool.connect();
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
      await client.query("ROLLBACK");
      console.error(`Migration failed: ${migration.version}_${migration.name}:`, error);
      throw error;
    } finally {
      client.release();
    }

    if (migration.version === targetVersion) {
      break;
    }
  }
}

async function ensureMigrationsTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version TEXT NOT NULL,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (version)
    )
  `);
}

async function getAppliedMigrations(pool: pg.Pool): Promise<Map<string, MigrationRecord>> {
  const result = await pool.query<MigrationRecord>(
    "SELECT version, name, applied_at FROM _migrations ORDER BY version ASC",
  );
  const map = new Map<string, MigrationRecord>();
  for (const row of result.rows) {
    map.set(row.version, row);
  }
  return map;
}

interface AvailableMigration {
  version: string;
  name: string;
  fileName: string;
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
