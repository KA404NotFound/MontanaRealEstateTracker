// Compares each county's actual row count in `properties` against the live Cadastral
// API's count (excluding the null-PARCELID filler geometry we intentionally don't
// ingest — see Phase 1 Findings / cadastral.js). Re-fetches "expected" fresh from the
// API each run rather than a hardcoded snapshot, so it stays accurate as the source
// data changes over time, not just at whatever moment this script was written.
//
// Run inside the backend container (needs DB access via the same PG* env vars the app
// uses): node src/ingestion/verify.js

import { pool } from "../db/pool.js";
import { TARGET_COUNTIES } from "./runAll.js";

const CADASTRAL_LAYER_URL = "https://gisservice.mt.gov/arcgis/rest/services/msdi_cadastral_map_v1/MapServer/1/query";

async function expectedCount(county) {
  const params = new URLSearchParams({
    where: `CountyName='${county.replace(/'/g, "''")}' AND PARCELID IS NOT NULL`,
    returnCountOnly: "true",
    f: "json",
  });
  const res = await fetch(`${CADASTRAL_LAYER_URL}?${params.toString()}`);
  const body = await res.json();
  if (body.error) throw new Error(`Cadastral count query failed for ${county}: ${JSON.stringify(body.error)}`);
  return body.count;
}

async function main() {
  const { rows } = await pool.query(
    `SELECT county, COUNT(*)::int AS actual FROM properties WHERE county = ANY($1) GROUP BY county`,
    [TARGET_COUNTIES]
  );
  const actualByCounty = Object.fromEntries(rows.map((r) => [r.county, r.actual]));

  let mismatches = 0;
  let notYetIngested = 0;

  for (const county of TARGET_COUNTIES) {
    const expected = await expectedCount(county);
    const actual = actualByCounty[county] ?? 0;
    const diff = actual - expected;

    let flag = "OK";
    if (actual === 0) {
      flag = "NOT YET INGESTED";
      notYetIngested++;
    } else if (diff !== 0) {
      flag = "MISMATCH";
      mismatches++;
    }

    console.log(
      `${county.padEnd(16)} expected ${String(expected).padStart(7)}  actual ${String(actual).padStart(7)}  diff ${String(diff).padStart(6)}  ${flag}`
    );
  }

  console.log(
    `\n${mismatches} counties with a mismatch, ${notYetIngested} not yet ingested, ${
      TARGET_COUNTIES.length - mismatches - notYetIngested
    } clean, out of ${TARGET_COUNTIES.length} total.`
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
