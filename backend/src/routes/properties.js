import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 200;

// GET /api/properties?county=&minLat=&minLng=&maxLat=&maxLng=&q=&property_type=&min_value=&max_value=&page=&pageSize=
//
// At least one of `county` or a bounding box (all four of minLat/minLng/maxLat/maxLng)
// is required — with ~920k parcels statewide, an unfiltered scan isn't something this
// endpoint is meant to support. The bounding box is what scopes results to "what's
// currently visible on the map" — without it, results are just the N highest-assessed
// parcels in `county` regardless of location, which (especially once browsing without a
// county filter) tends to surface a handful of the priciest properties in the whole area
// rather than anything resembling what's actually in view.
// Returns parcel centroids (not full polygons) for map markers; fetch
// /api/properties/:id for full geometry.
router.get("/", async (req, res, next) => {
  try {
    const { county, q, property_type: propertyType, min_value: minValue, max_value: maxValue } = req.query;
    const { minLat, minLng, maxLat, maxLng } = req.query;

    const bboxParts = [minLng, minLat, maxLng, maxLat].map(Number);
    const hasBbox = [minLat, minLng, maxLat, maxLng].every((v) => v !== undefined && v !== "") && bboxParts.every((n) => Number.isFinite(n));

    if (!county && !hasBbox) {
      return res.status(400).json({ error: "county or a map bounding box (minLat/minLng/maxLat/maxLng) is required" });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.pageSize, 10) || DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * pageSize;

    const conditions = [];
    const params = [];

    if (county) {
      params.push(county);
      conditions.push(`county = $${params.length}`);
    }
    if (hasBbox) {
      const [bMinLng, bMinLat, bMaxLng, bMaxLat] = bboxParts;
      params.push(bMinLng, bMinLat, bMaxLng, bMaxLat);
      const n = params.length;
      // `&&` is the bounding-box-overlap operator — index-accelerated by idx_properties_geom.
      conditions.push(`geom && ST_MakeEnvelope($${n - 3}, $${n - 2}, $${n - 1}, $${n}, 4326)`);
    }
    if (q) {
      params.push(`%${q}%`);
      conditions.push(`(owner_name ILIKE $${params.length} OR address_line1 ILIKE $${params.length} OR parcel_id ILIKE $${params.length})`);
    }
    if (propertyType) {
      params.push(propertyType);
      conditions.push(`property_type = $${params.length}`);
    }
    if (minValue) {
      params.push(Number(minValue));
      conditions.push(`total_value >= $${params.length}`);
    }
    if (maxValue) {
      params.push(Number(maxValue));
      conditions.push(`total_value <= $${params.length}`);
    }

    const where = conditions.join(" AND ");

    // Separate arrays for the two queries — sharing (and mutating) one array between
    // them is a race: pool.query() doesn't bind parameters synchronously, it queues the
    // query and only serializes params once a connection is actually available, so a
    // later push() here landed before the earlier query's params were read, leaving it
    // bound against an array with 2 more elements than its SQL text has placeholders for.
    const countPromise = pool.query(`SELECT COUNT(*)::int AS count FROM properties WHERE ${where}`, params);

    const rowParams = [...params, pageSize, offset];
    const rowsPromise = pool.query(
      `
      SELECT
        id, parcel_id, county, owner_name, address_line1, city_state_zip,
        property_type, total_acres, total_land_value, total_building_value, total_value, tax_year,
        ST_Y(ST_Centroid(geom)) AS latitude,
        ST_X(ST_Centroid(geom)) AS longitude
      FROM properties
      WHERE ${where}
      ORDER BY total_value DESC NULLS LAST
      LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}
      `,
      rowParams
    );

    const [{ rows: countRows }, { rows }] = await Promise.all([countPromise, rowsPromise]);

    res.json({
      page,
      pageSize,
      total: countRows[0].count,
      results: rows,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/properties/:id — full detail including polygon geometry (GeoJSON).
router.get("/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        id, parcel_id, county, owner_name, owner_address_1, owner_address_2, owner_address_3,
        owner_city, owner_state, owner_zip, dba_name, care_of_taxpayer,
        address_line1, address_line2, city_state_zip, property_type, prop_access,
        total_acres, total_land_value, total_building_value, total_value, tax_year,
        levy_district, township, range, section, subdivision,
        last_ingested_at,
        ST_AsGeoJSON(geom)::json AS geometry
      FROM properties
      WHERE id = $1
      `,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "property not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
