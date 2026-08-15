import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

const TOP_OWNERS_LIMIT = 20;

// GET /api/ownership/summary?county=  (county optional — omit for statewide)
//
// Heuristic analysis derived entirely from OwnerName/OwnerState text patterns already
// present in the Cadastral data — there's no structured "owner type" field in the
// source, so this is pattern-matching (e.g. owner_name ILIKE '%LLC%'), not an
// authoritative classification. Good for spotting patterns (investor activity,
// out-of-state ownership concentration), not a legal/official determination.
router.get("/summary", async (req, res, next) => {
  try {
    const { county } = req.query;
    const countyFilter = county ? "AND county = $1" : "";
    const params = county ? [county] : [];

    const topOwnersPromise = pool.query(
      `
      SELECT
        owner_name,
        COUNT(*)::int AS parcel_count,
        SUM(total_value)::bigint AS total_assessed_value,
        MAX(owner_city) AS owner_city,
        MAX(owner_state) AS owner_state
      FROM properties
      WHERE owner_name IS NOT NULL ${countyFilter}
      GROUP BY owner_name
      HAVING COUNT(*) > 1
      ORDER BY parcel_count DESC
      LIMIT ${TOP_OWNERS_LIMIT}
      `,
      params
    );

    const residencyPromise = pool.query(
      `
      SELECT
        CASE
          WHEN owner_state IS NULL OR owner_state = '' THEN 'Unknown'
          WHEN owner_state = 'MT' THEN 'Montana'
          ELSE 'Out-of-State'
        END AS category,
        COUNT(*)::int AS parcel_count,
        SUM(total_value)::bigint AS total_assessed_value
      FROM properties
      WHERE 1=1 ${countyFilter}
      GROUP BY category
      `,
      params
    );

    const entityTypePromise = pool.query(
      `
      SELECT
        CASE
          WHEN owner_name IS NULL THEN 'Unknown'
          WHEN owner_name ILIKE '%TRIBE%' OR owner_name ILIKE '%TRIBAL%' OR owner_name ILIKE 'USA %'
            OR owner_name ILIKE '%UNITED STATES%' OR owner_name ILIKE 'STATE OF MONTANA%'
            OR owner_name ILIKE '% COUNTY%' OR owner_name ILIKE 'CITY OF%' THEN 'Government/Tribal'
          WHEN owner_name ILIKE '%LLC%' THEN 'LLC'
          WHEN owner_name ILIKE '%TRUST%' THEN 'Trust'
          WHEN owner_name ILIKE '%INC%' OR owner_name ILIKE '%CORP%' THEN 'Corporation'
          WHEN owner_name ILIKE '%LLP%' OR owner_name ILIKE '% LP' OR owner_name ILIKE '%PARTNERSHIP%' THEN 'Partnership'
          WHEN owner_name ILIKE '%ESTATE OF%' THEN 'Estate'
          ELSE 'Individual/Other'
        END AS category,
        COUNT(*)::int AS parcel_count,
        SUM(total_value)::bigint AS total_assessed_value
      FROM properties
      WHERE owner_name IS NOT NULL ${countyFilter}
      GROUP BY category
      ORDER BY parcel_count DESC
      `,
      params
    );

    const [topOwners, residency, entityType] = await Promise.all([topOwnersPromise, residencyPromise, entityTypePromise]);

    res.json({
      county: county || null,
      topOwners: topOwners.rows,
      residency: residency.rows,
      entityType: entityType.rows,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
