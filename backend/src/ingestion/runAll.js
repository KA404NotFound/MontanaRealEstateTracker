import { loadCountyToDb } from "./loadToDb.js";

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
 * Ingests all 6 target counties sequentially (one at a time, not in parallel — the
 * Cadastral API is a shared state resource and this isn't time-sensitive enough to
 * warrant hammering it concurrently).
 *
 * @param {import('pg').Pool} pool
 * @param {{ log?: (msg: string) => void }} [opts]
 */
export async function ingestAllCounties(pool, opts = {}) {
  const { log = console.log } = opts;
  const results = {};

  for (const county of TARGET_COUNTIES) {
    log(`Starting ingestion for ${county} County...`);
    const count = await loadCountyToDb(pool, county, { log });
    results[county] = count;
    log(`Finished ${county} County: ${count} parcels upserted.`);
  }

  log(`All counties ingested: ${JSON.stringify(results)}`);
  return results;
}
