import * as z from "zod/v4";
import { pool } from "./pool.js";
import { describeError } from "./describeError.js";

function json(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// The SDK's default error handling for a thrown/rejected tool handler just reads
// err.message — blank for the AggregateError a failed pg connection throws by default
// (see describeError.js), which would surface as a silent, unhelpful empty error to
// whatever's calling the tool. Wrap every handler so failures are actually legible.
function tool(handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${describeError(err)}` }], isError: true };
    }
  };
}

// Registers the read-only query tools on an McpServer instance. Deliberately its own
// SQL rather than importing from backend/src/routes/* — this is a separate service with
// its own trust boundary and its own (much looser, LLM-driven) input shapes, and at 5
// tools the duplication is small enough that sharing a query layer isn't worth the
// coupling yet (see Phase 8 in the plan doc).
export function registerTools(server) {
  server.registerTool(
    "list_counties",
    {
      title: "List Counties",
      description:
        "Lists all ingested Montana counties with parcel count and total/average assessed value. " +
        "Use this first to see what data is actually available before drilling into a specific county " +
        "with search_properties or get_market_metrics.",
      inputSchema: {},
    },
    tool(async () => {
      const { rows } = await pool.query(`
        SELECT
          county,
          COUNT(*)::int AS parcel_count,
          SUM(total_value)::bigint AS total_assessed_value,
          AVG(total_value)::numeric(15, 2) AS avg_assessed_value
        FROM properties
        GROUP BY county
        ORDER BY county
      `);
      return json(rows);
    })
  );

  server.registerTool(
    "search_properties",
    {
      title: "Search Properties",
      description:
        "Search Montana parcel records within a county, with optional filters. Returns up to `limit` " +
        "matching parcels sorted by assessed value descending. IMPORTANT: total_value is the tax " +
        "ASSESSED value, not a sale price — Montana law does not permit public disclosure of real " +
        "estate sale prices, so no sale-price data exists anywhere in this system.",
      inputSchema: {
        county: z.string().describe("County name, exact match, e.g. 'Flathead' or 'Lewis and Clark'"),
        q: z.string().optional().describe("Free-text search against owner name, street address, or parcel ID"),
        propertyType: z
          .string()
          .optional()
          .describe("Exact property type filter as recorded by the assessor, e.g. 'Vacant Land', 'Improved Property'"),
        minValue: z.number().optional().describe("Minimum total assessed value"),
        maxValue: z.number().optional().describe("Maximum total assessed value"),
        limit: z.number().int().min(1).max(200).default(20).describe("Max results to return (1-200)"),
      },
    },
    tool(async ({ county, q, propertyType, minValue, maxValue, limit }) => {
      const conditions = ["county = $1"];
      const params = [county];

      if (q) {
        params.push(`%${q}%`);
        conditions.push(`(owner_name ILIKE $${params.length} OR address_line1 ILIKE $${params.length} OR parcel_id ILIKE $${params.length})`);
      }
      if (propertyType) {
        params.push(propertyType);
        conditions.push(`property_type = $${params.length}`);
      }
      if (minValue != null) {
        params.push(minValue);
        conditions.push(`total_value >= $${params.length}`);
      }
      if (maxValue != null) {
        params.push(maxValue);
        conditions.push(`total_value <= $${params.length}`);
      }

      params.push(limit ?? 20);
      const { rows } = await pool.query(
        `
        SELECT id, parcel_id, county, owner_name, address_line1, city_state_zip,
               property_type, total_acres, total_value, tax_year
        FROM properties
        WHERE ${conditions.join(" AND ")}
        ORDER BY total_value DESC NULLS LAST
        LIMIT $${params.length}
        `,
        params
      );
      return json(rows);
    })
  );

  server.registerTool(
    "get_property",
    {
      title: "Get Property Detail",
      description:
        "Get full detail for one parcel by its internal numeric id (from search_properties results) " +
        "or its parcel_id (the assessor's parcel number).",
      inputSchema: {
        id: z.union([z.number(), z.string()]).describe("Internal numeric id or parcel_id string"),
      },
    },
    tool(async ({ id }) => {
      const idStr = String(id);
      const selectColumns = `
        id, parcel_id, county, owner_name, owner_address_1, owner_address_2, owner_address_3,
        owner_city, owner_state, owner_zip, dba_name, care_of_taxpayer,
        address_line1, address_line2, city_state_zip, property_type, prop_access,
        total_acres, total_land_value, total_building_value, total_value, tax_year,
        levy_district, township, range, section, subdivision
      `;

      // Montana parcel_id values are themselves long all-digit strings (e.g.
      // "07292313170027002"), so a plain /^\d+$/ test can't tell a parcel_id apart from
      // the internal SERIAL id — both are "numeric". Try parcel_id first (the expected
      // input for most external lookups) and only fall back to id if that misses and the
      // input actually parses as one (internal ids only ever come from search_properties
      // results, so this path matters much less in practice).
      let { rows } = await pool.query(
        `SELECT ${selectColumns} FROM properties WHERE parcel_id = $1`,
        [idStr]
      );

      if (rows.length === 0 && /^\d+$/.test(idStr)) {
        ({ rows } = await pool.query(`SELECT ${selectColumns} FROM properties WHERE id = $1`, [Number(idStr)]));
      }

      if (rows.length === 0) {
        return { content: [{ type: "text", text: `No property found for id/parcel_id: ${id}` }], isError: true };
      }
      return json(rows[0]);
    })
  );

  server.registerTool(
    "get_market_metrics",
    {
      title: "Get Market Metrics",
      description:
        "Get market data snapshots for a county. Two kinds of rows can appear, distinguished by " +
        "`source`: a self-computed ASSESSED-value snapshot (every county, always available — " +
        "median_price/avg_price only, no listing data) and, only where a FRED series exists " +
        "(populous counties — small counties routinely have none), real median LISTING price / " +
        "active listing count / median days on market from Realtor.com via FRED. Check `source` on " +
        "each row before interpreting median_price — it means different things depending on which " +
        "kind of row it is. Neither is a sale price: Montana does not publicly disclose real estate " +
        "sale prices, and no free structured source of real sale/transaction data covers all counties.",
      inputSchema: {
        county: z.string().describe("County name, exact match"),
      },
    },
    tool(async ({ county }) => {
      const { rows } = await pool.query(
        `SELECT period_date, period_type, source, median_price, avg_price, active_listings, avg_days_on_market, notes
         FROM market_metrics WHERE county = $1 ORDER BY period_date DESC`,
        [county]
      );
      return json(rows);
    })
  );

  server.registerTool(
    "find_multi_parcel_owners",
    {
      title: "Find Multi-Parcel Owners",
      description:
        "Find owners holding more than a given number of parcels, optionally scoped to a county " +
        "(omit county for statewide — slower, scans all counties). A heuristic view derived from " +
        "owner-name text matching in the assessor data, not an authoritative ownership registry — " +
        "the same owner recorded under slightly different name spellings across parcels won't be " +
        "merged together.",
      inputSchema: {
        county: z.string().optional().describe("County name to scope to; omit for statewide"),
        minParcels: z.number().int().min(2).default(2).describe("Minimum number of parcels an owner must hold to be included"),
        limit: z.number().int().min(1).max(200).default(20).describe("Max owners to return"),
      },
    },
    tool(async ({ county, minParcels, limit }) => {
      const conditions = ["owner_name IS NOT NULL"];
      const params = [];

      if (county) {
        params.push(county);
        conditions.push(`county = $${params.length}`);
      }

      params.push(minParcels ?? 2);
      const havingParamIndex = params.length;
      params.push(limit ?? 20);

      const { rows } = await pool.query(
        `
        SELECT
          owner_name,
          COUNT(*)::int AS parcel_count,
          SUM(total_value)::bigint AS total_assessed_value,
          (ARRAY_AGG(owner_city ORDER BY id))[1] AS owner_city,
          (ARRAY_AGG(owner_state ORDER BY id))[1] AS owner_state
        FROM properties
        WHERE ${conditions.join(" AND ")}
        GROUP BY owner_name
        HAVING COUNT(*) >= $${havingParamIndex}
        ORDER BY parcel_count DESC
        LIMIT $${params.length}
        `,
        params
      );
      return json(rows);
    })
  );
}
