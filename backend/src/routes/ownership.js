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

    // city/state must come from the same row — independent MAX(owner_city)/
    // MAX(owner_state) can each pick from a *different* parcel's mailing address (an
    // owner can have several on file), producing a city/state pair that never actually
    // existed together. Rather than ARRAY_AGG-ing every row in every group just to read
    // element [1] (cost scales with group size — worst for exactly the highest-parcel-
    // count owners this query exists to surface), the subquery only computes cheap
    // aggregates (COUNT/SUM/MIN) and narrows to the winning 20 via LIMIT *before* joining
    // back to properties for the one representative row each needs.
    const topOwnersPromise = pool.query(
      `
      SELECT o.owner_name, o.parcel_count, o.total_assessed_value, p.owner_city, p.owner_state
      FROM (
        SELECT
          owner_name,
          COUNT(*)::int AS parcel_count,
          SUM(total_value)::bigint AS total_assessed_value,
          MIN(id) AS rep_id
        FROM properties
        WHERE owner_name IS NOT NULL ${countyFilter}
        GROUP BY owner_name
        HAVING COUNT(*) > 1
        ORDER BY parcel_count DESC
        LIMIT ${TOP_OWNERS_LIMIT}
      ) o
      JOIN properties p ON p.id = o.rep_id
      ORDER BY o.parcel_count DESC
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
          -- Unanchored '%INC%'/'%CORP%' substring matching misclassifies real names —
          -- "LINCOLN", "PRINCE", "VINCENT", "PROVINCE" all contain "INC"; "SCORPION"
          -- contains "CORP". \y is Postgres's word-boundary regex metacharacter, so this
          -- only matches INC/CORP as a whole word (still matches "SMITH INC.", the period
          -- counts as a boundary) — with INCORPORATED/CORPORATION checked separately
          -- since spelling them out means no word boundary lands after "INC"/"CORP".
          WHEN owner_name ~* '\\yINC\\y' OR owner_name ~* 'INCORPORATED'
            OR owner_name ~* '\\yCORP\\y' OR owner_name ~* 'CORPORATION' THEN 'Corporation'
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
