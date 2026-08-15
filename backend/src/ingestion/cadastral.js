// Client for Montana's statewide Cadastral parcel feature layer (MSL + DOR ORION data).
// Covers all 6 target counties from one endpoint — see Phase 1 Findings in
// Montana_Real_Estate_Tracker_Plan.md for why this replaced per-county scrapers.

import { pathToFileURL } from "node:url";

const CADASTRAL_LAYER_URL =
  "https://gisservice.mt.gov/arcgis/rest/services/msdi_cadastral_map_v1/MapServer/1/query";

const MAX_RECORDS_PER_QUERY = 2000; // server-enforced cap
const MAX_FETCH_RETRIES = 4;
const FETCH_RETRY_BASE_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A full 6-county run makes 150+ sequential requests to a single government GIS server
// over 20-40 minutes — a single timeout/502 shouldn't be fatal to the whole run.
async function fetchWithRetry(url) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Cadastral query failed: ${res.status} ${res.statusText}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_FETCH_RETRIES) {
        await sleep(FETCH_RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }
  throw lastErr;
}

const OUT_FIELDS = [
  "PARCELID",
  "CountyName",
  "OwnerName",
  "OwnerAddress1",
  "OwnerAddress2",
  "OwnerAddress3",
  "OwnerCity",
  "OwnerState",
  "OwnerZipCode",
  "DbaName",
  "CareOfTaxpayer",
  "AddressLine1",
  "AddressLine2",
  "CityStateZip",
  "PropType",
  "PropAccess",
  "TotalAcres",
  "TotalLandValue",
  "TotalBuildingValue",
  "TotalValue",
  "TaxYear",
  "LevyDistrict",
  "Township",
  "Range",
  "Section",
  "Subdivision",
].join(",");

/**
 * Fetches every parcel for a given Montana county from the statewide Cadastral layer,
 * paginating past the server's 2,000-record-per-query cap.
 *
 * By default accumulates and returns every feature (fine for ad-hoc/CLI use). For bulk
 * loading (counties run 30k-85k+ parcels each), pass `accumulate: false` and consume
 * pages via `onPage` instead — avoids holding the whole county in memory at once.
 *
 * @param {string} countyName - e.g. "Flathead" (must match CountyName field exactly)
 * @param {{ includeGeometry?: boolean, accumulate?: boolean, onPage?: (page: object[], total: number) => void | Promise<void> }} [opts]
 * @returns {Promise<object[] | number>} array of GeoJSON-style features (accumulate: true), or total count (accumulate: false)
 */
export async function fetchCountyParcels(countyName, opts = {}) {
  const { includeGeometry = true, accumulate = true, onPage } = opts;
  const features = accumulate ? [] : null;
  let total = 0;
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      where: `CountyName='${countyName.replace(/'/g, "''")}'`,
      outFields: OUT_FIELDS,
      f: "geojson",
      outSR: "4326",
      returnGeometry: String(includeGeometry),
      resultOffset: String(offset),
      resultRecordCount: String(MAX_RECORDS_PER_QUERY),
    });

    const res = await fetchWithRetry(`${CADASTRAL_LAYER_URL}?${params.toString()}`);
    const body = await res.json();
    if (body.error) {
      throw new Error(`Cadastral query error: ${JSON.stringify(body.error)}`);
    }

    const page = body.features ?? [];
    total += page.length;
    if (accumulate) features.push(...page);
    await onPage?.(page, total);

    if (page.length < MAX_RECORDS_PER_QUERY) break;
    offset += MAX_RECORDS_PER_QUERY;
  }

  return accumulate ? features : total;
}

// CLI entry point: node src/ingestion/cadastral.js [CountyName]
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const county = process.argv[2] || "Flathead";
  console.log(`Fetching parcels for ${county} County...`);

  const features = await fetchCountyParcels(county, {
    onPage: (page, total) => console.log(`  fetched page of ${page.length} (running total: ${total})`),
  });

  console.log(`Done: ${features.length} parcels for ${county} County.`);
  if (features.length > 0) {
    console.log("Sample record:", JSON.stringify(features[0], null, 2));
  }
}
