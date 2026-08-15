import { Router } from "express";
import { pool } from "../db/pool.js";
import { TARGET_COUNTIES } from "../ingestion/runAll.js";

const router = Router();

// GET /api/counties — summary stats per county, for the county selector + overview cards.
router.get("/", async (req, res, next) => {
  try {
    // Bounding box per county (from actual parcel geometry) lets the frontend fly the
    // map to a county's real extent on selection, instead of guessing/hardcoding
    // coordinates for 56 counties.
    const { rows } = await pool.query(`
      SELECT
        county,
        COUNT(*)::int AS parcel_count,
        SUM(total_value)::bigint AS total_assessed_value,
        AVG(total_value)::numeric(15,2) AS avg_assessed_value,
        MAX(last_ingested_at) AS last_ingested_at,
        ST_XMin(ST_Extent(geom)) AS min_lng,
        ST_YMin(ST_Extent(geom)) AS min_lat,
        ST_XMax(ST_Extent(geom)) AS max_lng,
        ST_YMax(ST_Extent(geom)) AS max_lat
      FROM properties
      GROUP BY county
      ORDER BY county
    `);

    // Include target counties with zero rows so the selector shows all of them even
    // before their first ingestion run completes.
    const byCounty = Object.fromEntries(rows.map((r) => [r.county, r]));
    const full = TARGET_COUNTIES.map(
      (county) =>
        byCounty[county] ?? {
          county,
          parcel_count: 0,
          total_assessed_value: null,
          avg_assessed_value: null,
          last_ingested_at: null,
          min_lng: null,
          min_lat: null,
          max_lng: null,
          max_lat: null,
        }
    );

    res.json(full);
  } catch (err) {
    next(err);
  }
});

export default router;
