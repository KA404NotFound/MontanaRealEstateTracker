// Client for Montana's statewide Cadastral parcel feature layer (MSL + DOR ORION data).
// Covers all 6 target counties from one endpoint — see Phase 1 Findings in
// Montana_Real_Estate_Tracker_Plan.md for why this replaced per-county scrapers.

import { pathToFileURL } from "node:url";

const CADASTRAL_LAYER_URL =
  "https://gisservice.mt.gov/arcgis/rest/services/msdi_cadastral_map_v1/MapServer/1/query";

const MAX_RECORDS_PER_QUERY = 2000; // server-enforced cap

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
 * @param {string} countyName - e.g. "Flathead" (must match CountyName field exactly)
 * @param {{ includeGeometry?: boolean, onPage?: (count: number, total: number) => void }} [opts]
 * @returns {Promise<object[]>} array of GeoJSON-style features
 */
export async function fetchCountyParcels(countyName, opts = {}) {
  const { includeGeometry = true, onPage } = opts;
  const features = [];
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

    const res = await fetch(`${CADASTRAL_LAYER_URL}?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Cadastral query failed: ${res.status} ${res.statusText}`);
    }

    const body = await res.json();
    if (body.error) {
      throw new Error(`Cadastral query error: ${JSON.stringify(body.error)}`);
    }

    const page = body.features ?? [];
    features.push(...page);
    onPage?.(page.length, features.length);

    if (page.length < MAX_RECORDS_PER_QUERY) break;
    offset += MAX_RECORDS_PER_QUERY;
  }

  return features;
}

// CLI entry point: node src/ingestion/cadastral.js [CountyName]
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const county = process.argv[2] || "Flathead";
  console.log(`Fetching parcels for ${county} County...`);

  const features = await fetchCountyParcels(county, {
    onPage: (count, total) => console.log(`  fetched page of ${count} (running total: ${total})`),
  });

  console.log(`Done: ${features.length} parcels for ${county} County.`);
  if (features.length > 0) {
    console.log("Sample record:", JSON.stringify(features[0], null, 2));
  }
}
