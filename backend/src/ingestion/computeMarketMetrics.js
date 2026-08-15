// Computes a market_metrics snapshot straight from our own already-ingested parcel
// data, instead of pulling from an external source. See Phase 4 Week 3 in the plan doc
// for why: Montana has no free, structured, ToS-clean source of real sale-price/listing
// market activity covering all 56 counties — only a handful of populous counties have a
// realtor board publishing monthly reports, and even those are PDFs/dashboards that
// require a human to read and re-log every month. Median/average ASSESSED value (not
// sale price) is a legitimate, honest proxy that's fully automatic and covers every
// county the moment it's ingested.

import { pathToFileURL } from "node:url";

const SOURCE_LABEL = "Computed from Cadastral assessed values";
const NOTES =
  "Median/average TOTAL assessed value (not sale price) across ingested parcels for " +
  "this county, computed directly from the statewide Cadastral dataset. Montana does " +
  "not publicly disclose sale prices, so this is the closest legitimate, fully-automated " +
  "proxy available for all 56 counties.";

function firstOfCurrentMonth() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

/**
 * Upserts one market_metrics row per county with the current median/average assessed
 * value, computed from `properties`. Idempotent (safe to re-run) via the table's
 * (county, period_date, period_type) unique constraint — re-running within the same
 * month just refreshes that month's snapshot rather than creating duplicates.
 *
 * @param {import('pg').Pool} pool
 * @param {{ log?: (msg: string) => void }} [opts]
 * @returns {Promise<number>} number of counties updated
 */
export async function computeAssessedValueMetrics(pool, opts = {}) {
  const { log = () => {} } = opts;
  const periodDate = firstOfCurrentMonth();

  const { rows } = await pool.query(`
    SELECT
      county,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_value) AS median_price,
      AVG(total_value)::numeric(15, 2) AS avg_price
    FROM properties
    WHERE total_value IS NOT NULL
    GROUP BY county
  `);

  for (const row of rows) {
    await pool.query(
      `
      INSERT INTO market_metrics (county, period_date, period_type, source, median_price, avg_price, notes)
      VALUES ($1, $2, 'monthly', $3, $4, $5, $6)
      ON CONFLICT (county, period_date, period_type, source)
      DO UPDATE SET
        median_price = EXCLUDED.median_price,
        avg_price = EXCLUDED.avg_price,
        source = EXCLUDED.source,
        notes = EXCLUDED.notes
      `,
      [row.county, periodDate, SOURCE_LABEL, row.median_price, row.avg_price, NOTES]
    );
  }

  log(`Computed assessed-value market metrics for ${rows.length} counties (period ${periodDate}).`);
  return rows.length;
}

// CLI entry point: node src/ingestion/computeMarketMetrics.js
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { pool } = await import("../db/pool.js");
  const count = await computeAssessedValueMetrics(pool, { log: console.log });
  console.log(`Done: ${count} counties updated.`);
  await pool.end();
}
