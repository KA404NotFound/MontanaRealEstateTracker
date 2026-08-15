import { loadCountyToDb } from "./loadToDb.js";
import { describeError } from "../lib/describeError.js";

// Must match CountyName exactly as stored in the Cadastral layer — verified against the
// live API on 2026-08-14 (note: "Lewis and Clark", not "Lewis & Clark" — the latter
// returns zero rows).
export const TARGET_COUNTIES = [
  "Flathead",
  "Gallatin",
  "Missoula",
  "Yellowstone",
  "Lewis and Clark",
  "Ravalli",
];

/**
 * Ingests target counties sequentially (one at a time, not in parallel — the Cadastral
 * API is a shared state resource and this isn't time-sensitive enough to warrant
 * hammering it concurrently).
 *
 * @param {import('pg').Pool} pool
 * @param {{ log?: (msg: string) => void, onlyMissing?: boolean }} [opts]
 *   `onlyMissing: true` skips counties that already have at least one row — used at
 *   startup so a container restart after a partial/failed run self-heals (picks up
 *   wherever ingestion left off) instead of silently sitting on incomplete coverage
 *   until the next monthly cron. Cron and the manual /api/ingest trigger both use the
 *   default (false) — a full refresh, since assessed values do change and upserts are
 *   idempotent either way.
 */
export async function ingestAllCounties(pool, opts = {}) {
  const { log = console.log, onlyMissing = false } = opts;
  const results = {};

  let alreadyPopulated = new Set();
  if (onlyMissing) {
    const { rows } = await pool.query(
      `SELECT county FROM properties WHERE county = ANY($1) GROUP BY county HAVING COUNT(*) > 0`,
      [TARGET_COUNTIES]
    );
    alreadyPopulated = new Set(rows.map((r) => r.county));
  }

  for (const county of TARGET_COUNTIES) {
    if (onlyMissing && alreadyPopulated.has(county)) {
      log(`${county} County already has data — skipping (gap-fill mode).`);
      continue;
    }
    log(`Starting ingestion for ${county} County...`);
    try {
      const { loaded, failed } = await loadCountyToDb(pool, county, { log });
      results[county] = { loaded, failed };
      log(`Finished ${county} County: ${loaded} parcels upserted${failed ? `, ${failed} skipped` : ""}.`);
    } catch (err) {
      // DB-write faults are already isolated per-row inside loadCountyToDb — this catches
      // the other failure class: the Cadastral API fetch itself giving up (exhausted
      // retries, a non-2xx it won't recover from). Without this, one county's API outage
      // would abort every county after it in TARGET_COUNTIES for this run.
      results[county] = { loaded: 0, failed: 0, error: describeError(err) };
      log(`${county} County ingestion failed — skipping to next county: ${describeError(err)}`);
    }
  }

  log(`Ingestion run complete: ${JSON.stringify(results)}`);
  return results;
}
