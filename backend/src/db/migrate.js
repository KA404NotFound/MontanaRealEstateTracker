// Lightweight schema migration runner — no framework, just numbered .sql files in
// db/migrations/ tracked against a schema_migrations table.
//
// Unlike relying on Postgres's docker-entrypoint-initdb.d (which only ever runs once,
// on a completely empty data volume — the root cause of two separate manual-fix
// incidents: schema.sql silently never applying, then two follow-up schema changes each
// needing a hand-run ALTER/CREATE INDEX via the Portainer console), this runs on every
// backend startup and actually applies whatever's new to an existing, already-populated
// database. Safe to run repeatedly — already-applied migrations are skipped.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "db", "migrations");

/**
 * @param {import('pg').Pool} pool
 * @param {{ log?: (msg: string) => void }} [opts]
 * @returns {Promise<number>} number of migrations applied this run
 */
export async function runMigrations(pool, opts = {}) {
  const { log = console.log } = opts;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const { rows } = await pool.query(`SELECT filename FROM schema_migrations`);
  const applied = new Set(rows.map((r) => r.filename));

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  let appliedCount = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      log(`Applied migration: ${file}`);
      appliedCount++;
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed, rolled back: ${err.message}`);
    } finally {
      client.release();
    }
  }

  log(appliedCount === 0 ? "No pending migrations." : `Applied ${appliedCount} migration(s).`);
  return appliedCount;
}
