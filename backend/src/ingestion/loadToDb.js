import { fetchCountyParcels } from "./cadastral.js";

// Kept well under Postgres's 65535 bound-parameter limit (27 columns * 500 rows = 13,500).
const DB_BATCH_SIZE = 500;

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
    p.TotalLandValue,
    p.TotalBuildingValue,
    p.TotalValue,
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

async function upsertRows(pool, rows) {
  if (rows.length === 0) return;

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

  const sql = `
    INSERT INTO properties (${COLUMNS.join(", ")})
    VALUES ${valueGroups.join(", ")}
    ON CONFLICT (parcel_id) DO UPDATE SET ${updateSet}
  `;

  await pool.query(sql, params);
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
 * @returns {Promise<number>} total parcels upserted
 */
export async function loadCountyToDb(pool, countyName, opts = {}) {
  const { log = () => {} } = opts;
  let loaded = 0;

  await fetchCountyParcels(countyName, {
    accumulate: false,
    onPage: async (page) => {
      const rows = page.map(featureToRow);
      for (const batch of chunk(rows, DB_BATCH_SIZE)) {
        await upsertRows(pool, batch);
        loaded += batch.length;
      }
      log(`${countyName}: upserted ${loaded} parcels so far`);
    },
  });

  return loaded;
}
