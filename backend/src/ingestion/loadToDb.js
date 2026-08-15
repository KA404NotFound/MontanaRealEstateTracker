import { fetchCountyParcels } from "./cadastral.js";
import { describeError } from "../lib/describeError.js";

// Kept well under Postgres's 65535 bound-parameter limit (27 columns * 500 rows = 13,500).
const DB_BATCH_SIZE = 500;
const MAX_BATCH_RETRIES = 3;
const BATCH_RETRY_BASE_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The Cadastral value fields are typed Double on the source Esri layer but map to
// INTEGER columns here (assessed dollar amounts are conceptually whole-dollar). Round
// defensively rather than let a stray fractional value (e.g. 42.5) throw a Postgres
// integer-cast error and take out the whole batch it's in.
function toRoundedIntOrNull(value) {
  return value === null || value === undefined ? null : Math.round(value);
}

const COLUMNS = [
  "parcel_id",
  "county",
  "owner_name",
  "owner_address_1",
  "owner_address_2",
  "owner_address_3",
  "owner_city",
  "owner_state",
  "owner_zip",
  "dba_name",
  "care_of_taxpayer",
  "address_line1",
  "address_line2",
  "city_state_zip",
  "property_type",
  "prop_access",
  "total_acres",
  "total_land_value",
  "total_building_value",
  "total_value",
  "tax_year",
  "levy_district",
  "township",
  "range",
  "section",
  "subdivision",
  "geom",
];

function featureToRow(feature) {
  const p = feature.properties;
  return [
    p.PARCELID,
    p.CountyName,
    p.OwnerName,
    p.OwnerAddress1,
    p.OwnerAddress2,
    p.OwnerAddress3,
    p.OwnerCity,
    p.OwnerState,
    p.OwnerZipCode,
    p.DbaName,
    p.CareOfTaxpayer,
    p.AddressLine1,
    p.AddressLine2,
    p.CityStateZip,
    p.PropType,
    p.PropAccess,
    p.TotalAcres,
    toRoundedIntOrNull(p.TotalLandValue),
    toRoundedIntOrNull(p.TotalBuildingValue),
    toRoundedIntOrNull(p.TotalValue),
    p.TaxYear,
    p.LevyDistrict,
    p.Township,
    p.Range,
    p.Section,
    p.Subdivision,
    feature.geometry ? JSON.stringify(feature.geometry) : null,
  ];
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function buildUpsertQuery(rows) {
  const valueGroups = [];
  const params = [];
  rows.forEach((row, i) => {
    const base = i * COLUMNS.length;
    const placeholders = COLUMNS.map((col, j) =>
      col === "geom" ? `ST_SetSRID(ST_GeomFromGeoJSON($${base + j + 1}), 4326)` : `$${base + j + 1}`
    );
    valueGroups.push(`(${placeholders.join(", ")})`);
    params.push(...row);
  });

  const updateSet = COLUMNS.filter((c) => c !== "parcel_id")
    .map((c) => `${c} = EXCLUDED.${c}`)
    .concat(["last_ingested_at = CURRENT_TIMESTAMP", "updated_at = CURRENT_TIMESTAMP"])
    .join(", ");

  return {
    sql: `
      INSERT INTO properties (${COLUMNS.join(", ")})
      VALUES ${valueGroups.join(", ")}
      ON CONFLICT (parcel_id) DO UPDATE SET ${updateSet}
    `,
    params,
  };
}

async function upsertBatchOnce(pool, rows) {
  const { sql, params } = buildUpsertQuery(rows);
  await pool.query(sql, params);
}

/**
 * Upserts a batch of rows, retrying transient failures whole-batch first. If the batch
 * still fails after retries, falls back to inserting one row at a time so a single bad
 * record (malformed geometry, unexpected type, etc.) doesn't drop the rest of the batch —
 * without this, one bad parcel anywhere in a 500-row batch silently takes the other 499
 * good ones down with it.
 *
 * @returns {Promise<{ succeeded: number, failed: number }>}
 */
async function upsertRows(pool, rows, opts = {}) {
  const { log = () => {} } = opts;
  if (rows.length === 0) return { succeeded: 0, failed: 0 };

  for (let attempt = 1; attempt <= MAX_BATCH_RETRIES; attempt++) {
    try {
      await upsertBatchOnce(pool, rows);
      return { succeeded: rows.length, failed: 0 };
    } catch (err) {
      if (attempt < MAX_BATCH_RETRIES) {
        log(`Batch upsert failed (attempt ${attempt}/${MAX_BATCH_RETRIES}), retrying: ${describeError(err)}`);
        await sleep(BATCH_RETRY_BASE_DELAY_MS * attempt);
      } else {
        log(`Batch upsert failed after ${MAX_BATCH_RETRIES} attempts — falling back to per-row upsert to isolate bad records: ${describeError(err)}`);
      }
    }
  }

  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await upsertBatchOnce(pool, [row]);
      succeeded++;
    } catch (err) {
      failed++;
      log(`Skipping parcel ${row[0]} (${row[1]}) — upsert failed: ${describeError(err)}`);
    }
  }
  return { succeeded, failed };
}

/**
 * Streams one county's parcels from the Cadastral API straight into the `properties`
 * table, upserting on `parcel_id`. Processes page-by-page (2,000 records at a time from
 * the API, sub-batched to 500 for the DB write) rather than materializing the whole
 * county in memory — counties run 30k-85k+ parcels each.
 *
 * @param {import('pg').Pool} pool
 * @param {string} countyName
 * @param {{ log?: (msg: string) => void }} [opts]
 * @returns {Promise<{ loaded: number, failed: number }>} total parcels upserted vs. skipped
 */
export async function loadCountyToDb(pool, countyName, opts = {}) {
  const { log = () => {} } = opts;
  let loaded = 0;
  let failed = 0;

  await fetchCountyParcels(countyName, {
    accumulate: false,
    onPage: async (page) => {
      const rows = page.map(featureToRow);
      for (const batch of chunk(rows, DB_BATCH_SIZE)) {
        const result = await upsertRows(pool, batch, { log });
        loaded += result.succeeded;
        failed += result.failed;
      }
      log(`${countyName}: upserted ${loaded} parcels so far${failed ? ` (${failed} skipped)` : ""}`);
    },
  });

  return { loaded, failed };
}
