// Pulls real market-activity data (median LISTING price, active listing count, median
// days on market) per county from FRED's "Housing Inventory Core Metrics" release —
// itself sourced from Realtor.com, republished by the Federal Reserve as a clean,
// documented, free API. This is a different, better category than the manual-PDF-reading
// route declined in Phase 4 Week 3: it's a real structured feed, fully automatable, same
// shape as the Cadastral ingestion. Complements (doesn't replace) the self-computed
// assessed-value layer in computeMarketMetrics.js — see the "FRED market data
// integration" note in the plan doc for the full rationale.
//
// Coverage is inherently incomplete: FRED/Realtor.com only publishes a series where
// there's enough listing volume to be meaningful, so small rural counties routinely have
// none of these three series at all (verified directly against the live API — e.g.
// Petroleum County, population ~450, returns a clean "series does not exist" for median
// listing price). That's expected, not a bug — skipped gracefully, not retried.

import { pathToFileURL } from "node:url";
import { pool } from "../db/pool.js";
import { TARGET_COUNTIES } from "./targetCounties.js";
import { describeError } from "../lib/describeError.js";

const FRED_API_BASE = "https://api.stlouisfed.org/fred/series/observations";
// FRED's documented rate limit is 120 requests/minute per API key (verified against
// their terms of use, not assumed). 600ms between requests caps us at 100/min — under
// the limit with real margin, not just technically-under.
const REQUEST_DELAY_MS = 600;

// Montana county name -> 5-digit FIPS code. Verified against the official FCC FIPS list
// (transition.fcc.gov/oet/info/maps/census/fips/fips.txt), cross-checked against
// Wikipedia's List of counties in Montana — both agree exactly. Keys must match
// TARGET_COUNTIES (targetCounties.js) spelling precisely.
const COUNTY_FIPS = {
  Beaverhead: "30001",
  "Big Horn": "30003",
  Blaine: "30005",
  Broadwater: "30007",
  Carbon: "30009",
  Carter: "30011",
  Cascade: "30013",
  Chouteau: "30015",
  Custer: "30017",
  Daniels: "30019",
  Dawson: "30021",
  "Deer Lodge": "30023",
  Fallon: "30025",
  Fergus: "30027",
  Flathead: "30029",
  Gallatin: "30031",
  Garfield: "30033",
  Glacier: "30035",
  "Golden Valley": "30037",
  Granite: "30039",
  Hill: "30041",
  Jefferson: "30043",
  "Judith Basin": "30045",
  Lake: "30047",
  "Lewis and Clark": "30049",
  Liberty: "30051",
  Lincoln: "30053",
  McCone: "30055",
  Madison: "30057",
  Meagher: "30059",
  Mineral: "30061",
  Missoula: "30063",
  Musselshell: "30065",
  Park: "30067",
  Petroleum: "30069",
  Phillips: "30071",
  Pondera: "30073",
  "Powder River": "30075",
  Powell: "30077",
  Prairie: "30079",
  Ravalli: "30081",
  Richland: "30083",
  Roosevelt: "30085",
  Rosebud: "30087",
  Sanders: "30089",
  Sheridan: "30091",
  "Silver Bow": "30093",
  Stillwater: "30095",
  "Sweet Grass": "30097",
  Teton: "30099",
  Toole: "30101",
  Treasure: "30103",
  Valley: "30105",
  Wheatland: "30107",
  Wibaux: "30109",
  Yellowstone: "30111",
};

const METRICS = [
  { seriesPrefix: "MEDLISPRI", column: "median_price" },
  { seriesPrefix: "ACTLISCOU", column: "active_listings" },
  { seriesPrefix: "MEDDAYONMAR", column: "avg_days_on_market" },
];

// Verified directly against the FRED API (series/tags for MEDLISPRI30029) that this
// series is classified "Copyrighted: Citation Required" — not "Pre-approval Required",
// so usage is fine, but citing both the original data owner (Realtor.com) and the
// redistributing platform (FRED) is a real requirement here, not just good practice.
// This label is stored in `source` and rendered directly in the dashboard's Assessed
// Value Trends table (frontend/src/components/MarketMetrics.jsx), so the citation is
// actually visible wherever this data appears — not just present in a DB column no one
// reads.
const SOURCE_LABEL = "Realtor.com, via FRED (Federal Reserve Bank of St. Louis, fred.stlouisfed.org)";
const NOTES =
  "Median LISTING price (not sale price — Montana doesn't disclose those), active " +
  "listing count, and MEDIAN days on market (the schema column is named " +
  "avg_days_on_market but FRED's series is a median, not a mean). Original data from " +
  "Realtor.com's Housing Inventory Core Metrics, retrieved via the Federal Reserve Bank " +
  "of St. Louis's FRED database (fred.stlouisfed.org) — copyrighted, citation required. " +
  "Not every county has this data — small rural counties often don't have enough listing " +
  "volume for Realtor.com/FRED to publish a series at all.";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLatestObservation(seriesId, apiKey) {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    sort_order: "desc",
    limit: "1",
  });

  const res = await fetch(`${FRED_API_BASE}?${params.toString()}`);
  if (!res.ok) {
    if (res.status === 400) return null; // "series does not exist" — expected for small counties
    throw new Error(`FRED request failed for ${seriesId}: ${res.status} ${res.statusText}`);
  }

  const body = await res.json();
  const obs = body.observations?.[0];
  if (!obs || obs.value === ".") return null; // "." is FRED's null-observation marker
  return { date: obs.date, value: Number(obs.value) };
}

async function fetchCountyMarketData(county, apiKey) {
  const fips = COUNTY_FIPS[county];
  if (!fips) throw new Error(`No FIPS code mapped for county: ${county}`);

  // The three metrics are independent FRED series that don't always update in lockstep
  // (revision timing, a temporarily-suppressed low-volume month, etc. routinely cause a
  // month of skew between siblings for the same county). Taking each series' own latest
  // date and writing every value under a single max() date would silently misattribute a
  // stale value to a period it doesn't actually belong to. Instead: collect each metric
  // with its own real date, pick whichever date the most metrics agree on (ties broken
  // toward the more recent one), and only keep values that actually match that date —
  // a metric that's out of step with the rest gets dropped for this run, not mislabeled.
  const observations = {};
  for (const { seriesPrefix, column } of METRICS) {
    const obs = await fetchLatestObservation(`${seriesPrefix}${fips}`, apiKey);
    await sleep(REQUEST_DELAY_MS);
    if (obs) observations[column] = obs;
  }

  const dates = Object.values(observations).map((o) => o.date);
  if (dates.length === 0) return null;

  const dateCounts = {};
  for (const d of dates) dateCounts[d] = (dateCounts[d] || 0) + 1;
  const [periodDate] = Object.keys(dateCounts).sort((a, b) => {
    const byAgreement = dateCounts[b] - dateCounts[a];
    return byAgreement !== 0 ? byAgreement : a < b ? 1 : -1;
  });

  const result = {};
  for (const [column, obs] of Object.entries(observations)) {
    if (obs.date === periodDate) result[column] = obs.value;
  }

  return { ...result, periodDate };
}

/**
 * Fetches and upserts FRED market data for every target county. Skips gracefully
 * (logged, not an error) for counties with no FRED series at all. No-ops entirely if
 * FRED_API_KEY isn't set, rather than failing the caller.
 *
 * @param {import('pg').Pool} pool
 * @param {{ log?: (msg: string) => void }} [opts]
 * @returns {Promise<{ updated: number, skipped: number }>}
 */
export async function ingestFredMarketData(pool, opts = {}) {
  const { log = console.log } = opts;
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    log("FRED_API_KEY not set — skipping FRED market data ingestion.");
    return { updated: 0, skipped: 0 };
  }

  let updated = 0;
  let skipped = 0;

  for (const county of TARGET_COUNTIES) {
    try {
      const data = await fetchCountyMarketData(county, apiKey);
      if (!data) {
        skipped++;
        continue;
      }

      await pool.query(
        `
        INSERT INTO market_metrics
          (county, period_date, period_type, source, median_price, active_listings, avg_days_on_market, notes)
        VALUES ($1, $2, 'monthly', $3, $4, $5, $6, $7)
        ON CONFLICT (county, period_date, period_type, source)
        DO UPDATE SET
          median_price = EXCLUDED.median_price,
          active_listings = EXCLUDED.active_listings,
          avg_days_on_market = EXCLUDED.avg_days_on_market,
          notes = EXCLUDED.notes
        `,
        [county, data.periodDate, SOURCE_LABEL, data.median_price ?? null, data.active_listings ?? null, data.avg_days_on_market ?? null, NOTES]
      );
      updated++;
    } catch (err) {
      log(`FRED market data fetch failed for ${county}: ${describeError(err)}`);
    }
  }

  log(`FRED market data: ${updated} counties updated, ${skipped} had no FRED series available.`);
  return { updated, skipped };
}

// CLI entry point: node src/ingestion/fredMarketData.js
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await ingestFredMarketData(pool, { log: console.log });
  console.log(`Done: ${JSON.stringify(result)}`);
  await pool.end();
}
