# Montana Multi-County Real Estate Tracker — Project Plan

---

## Phase 1 Findings (2026-08-14) — Revised Data Strategy

Research into actual Montana data sources significantly changes the Phase 1/4 approach. **This replaces the "6 separate county scrapers" assumption with one statewide API for the core property data.**

### 1. Statewide parcel/assessor data — one API covers all 6 counties

The **Montana Cadastral Framework** (Montana State Library + Dept. of Revenue, sourced from DOR's ORION appraisal system) is queryable live via ArcGIS REST — no per-county HTML scraping needed for ownership/assessment data:

- **Endpoint:** `https://gisservice.mt.gov/arcgis/rest/services/msdi_cadastral_map_v1/MapServer/1`
- **Query:** standard Esri REST query params (`where=`, `outFields=`, `f=geojson|json|pbf`), filterable by `CountyName`/`COUNTYCD`
- **Max 2,000 records/query** → need paginated queries (`resultOffset`/`resultRecordCount`), but that's a solved problem, not per-county parsing logic
- **Fields include:** `PARCELID`, `CountyName`, `OwnerName`, `OwnerAddress1-3/City/State/Zip`, `AddressLine1-2`, `CityStateZip`, `PropType`, `TotalAcres` (+ acreage breakdowns: irrigated/grazing/forest/etc.), `TotalLandValue`, `TotalBuildingValue`, `TotalValue`, `TaxYear`, `LevyDistrict`, `Township/Range/Section`, `Subdivision`, `Shape` (polygon geometry)
- Bulk alternative: monthly statewide shapefile/geodatabase exports via MSL FTP (`ftp.geoinfo.msl.mt.gov/Data/Spatial/MSDI/Cadastral/Parcels/Statewide/`) if we want a local mirror instead of hitting the live service repeatedly
- **Effect on plan:** collapses Week 2 ("Scraper v1 Flathead") + Week 4 ("adapt per county") into a single ingestion client. County-specific scraper work is no longer needed for the `properties` table.

### 2. Critical constraint: Montana is a non-disclosure state — sale prices are NOT public

Verified via MCA and the Realty Transfer Certificate (RTC) statute: sellers must file an RTC with the county/DOR on transfer, but **the certificate and the price on it are statutorily confidential** — the county clerk/recorder and DOR are required to withhold it from the public. This directly invalidates the original `sales.sale_price` / deed-sourced `price_history` design:

- **What deed records DO give us (public):** the fact and date of a transfer, grantor/grantee names, instrument type, legal description — via county Clerk & Recorder indexes. For Flathead: records 1984+ are indexed through **iDocMarket** (subscription/per-document fee), pre-1984 via County Record Archives. No free bulk deed price data exists.
- **What they do NOT give us:** sale price. That has to come from a non-county source (MLS-syndicated "sold" data via Zillow/Redfin, or nothing).

### 3. MLS access is not a public data source

**406MLS (Montana Regional MLS)** listing/IDX data is only available through NAR-governed IDX feeds, which require a broker/vendor agreement — not something scrapeable or open to a hobby project without a real estate license or paid vendor relationship (e.g., IDX Broker, PeakIDX). Local REALTOR associations (e.g., NMAR) publish aggregate market reports only, not per-listing data.

### 4. Remaining open question: where do listings + sold prices come from?

This is the one piece without a clean, free, ToS-compliant answer, and it's worth deciding deliberately rather than defaulting to scraping Zillow/Redfin (both prohibit scraping in their ToS — legal/blocking risk). Options, roughly in order of friskiness:
- **Aggregate-only trend data** from NMAR/local board reports (legit, free, but no per-property listings — waters down the "recent listings table" and "map of active listings" features)
- **Zillow/Redfin scraping** (delivers the v1 feature set as originally scoped, but against ToS — real risk of IP blocks/legal exposure)
- **Paid data source** (e.g., a licensed-agent IDX relationship, or a commercial real estate data API) — costs money, breaks the "free data only" assumption

**Decision (2026-08-14):** Go **aggregate-only** for listings/prices in v1. No per-property listing table, no price-on-map, no scraping of Zillow/Redfin/406MLS. v1 is a parcel/ownership/assessed-value explorer built entirely on the statewide Cadastral API, with market trend charts sourced from NMAR/local board published reports (manually logged or lightly parsed, since these are typically PDF/blog-style releases, not structured data). Per-listing data is an explicit v2+ decision, to be revisited only via a legitimate path (paid IDX/data vendor) — not scraping. This descopes the `listings` table and the deed-sourced parts of `sales`/`price_history` from v1 (see Phase 3 schema, Phase 4 roadmap, Phase 5 deliverables below — kept in the doc as future-facing but marked accordingly).

---

## Phase 1: Research & Data Source Mapping

**Target Counties (5-6):**
1. **Flathead County** (Kalispell) — Your backyard
2. **Gallatin County** (Bozeman) — Hot market, active
3. **Missoula County** — College town, liquidity
4. **Yellowstone County** (Billings) — Largest city in state
5. **Lewis & Clark County** (Helena) — Capital, stable
6. **Ravalli County** (Hamilton) — Smaller, emerging

**For Each County, Identify:**
- **Assessor website** (property records, values, ownership)
- **County GIS data** (parcel boundaries, maps)
- **Deed records** (sales transactions via County Clerk)
- **Alternative MLS access** (Zillow/Redfin scraping or local board data)

**Documentation Template:**
| County | Assessor URL | Data Format | Bulk Access? | Scrapeable? | GIS Available? | Notes |
|--------|--------------|-------------|--------------|------------|----------------|-------|
| Flathead | | | | | | |
| Gallatin | | | | | | |
| Missoula | | | | | | |
| Yellowstone | | | | | | |
| Lewis & Clark | | | | | | |
| Ravalli | | | | | | |

**Effort:** 1-2 hours per county (5-10 hours total)

---

## Phase 2: Tech Stack & Architecture

### Backend
- **Runtime:** Node.js + Express (or Python + Flask)
- **Database:** PostgreSQL with PostGIS extension
- **Scraping:** Cheerio (HTML parsing) or Puppeteer (browser automation)
- **Scheduling:** node-cron (scheduled data pulls)
- **Data Validation:** joi or zod (schema validation)

### Frontend
- **Framework:** React or Vue
- **Mapping:** Mapbox or Leaflet (geographic visualization)
- **Charts:** Chart.js or Recharts (trend visualization)
- **Styling:** Tailwind CSS or similar
- **State Management:** React Context or Vuex (depending on choice)

### Hosting & Deployment
- **Backend:** Render, Railway, or DigitalOcean ($5-15/mo)
- **Database:** PostgreSQL on same platform
- **Frontend:** Vercel (free tier)
- **Version Control:** GitHub (private or public)

### Data Pipeline Flow
```
County Data Sources
        ↓
   Scraper(s)
        ↓
   Parse & Clean
        ↓
   PostgreSQL
        ↓
   REST API
        ↓
   React Frontend
        ↓
   User Dashboard
```

---

## Phase 3: Database Schema (PostgreSQL)

**Note (2026-08-14):** Per the Phase 1 decision, v1 populates `properties` (from the Cadastral API) and `market_metrics` (aggregate, from realtor board reports). `listings`, `sales`, and `price_history` are kept below as forward-looking schema for if/when a legitimate per-listing data source is secured (see Phase 4 Week 6+) — they are not populated in v1, and `sales.sale_price`/deed-sourced `price_history` specifically cannot be populated from county deed records at all (Montana non-disclosure law).

### Core Tables

```sql
-- Properties table (base records from assessor data)
CREATE TABLE properties (
  id SERIAL PRIMARY KEY,
  county VARCHAR(50) NOT NULL,
  parcel_id VARCHAR(100) UNIQUE NOT NULL,
  address VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(2),
  zip VARCHAR(10),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  property_type VARCHAR(50), -- residential/commercial/land/mixed
  lot_size_acres DECIMAL(10, 4),
  building_sqft INTEGER,
  year_built INTEGER,
  assessed_value DECIMAL(15, 2),
  owner_name VARCHAR(255),
  owner_type VARCHAR(50), -- individual/corp/llc/trust
  last_scraped TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create geographic index for fast spatial queries
CREATE INDEX idx_properties_location ON properties USING GIST (
  ST_Point(longitude, latitude)
);

-- Listings table (active/pending/sold listings from MLS or Zillow)
CREATE TABLE listings (
  id SERIAL PRIMARY KEY,
  property_id INTEGER REFERENCES properties(id),
  source VARCHAR(50), -- zillow/redfin/mls/assessor
  list_price DECIMAL(15, 2),
  list_date DATE,
  delisted_date DATE,
  days_on_market INTEGER,
  status VARCHAR(50), -- active/pending/sold/delisted
  mls_number VARCHAR(100),
  url TEXT,
  scraped_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sales table (completed transactions)
CREATE TABLE sales (
  id SERIAL PRIMARY KEY,
  property_id INTEGER REFERENCES properties(id),
  sale_price DECIMAL(15, 2),
  sale_date DATE,
  sale_document_id VARCHAR(100),
  buyer_type VARCHAR(50), -- individual/corp/llc/investor
  seller_type VARCHAR(50),
  days_on_market INTEGER,
  source VARCHAR(50), -- deed/mls/assessor
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Price history (track price changes over time)
CREATE TABLE price_history (
  id SERIAL PRIMARY KEY,
  property_id INTEGER REFERENCES properties(id),
  price DECIMAL(15, 2),
  price_type VARCHAR(50), -- list/sale/assessed
  recorded_date DATE,
  source VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Market metrics (aggregated county/city stats)
CREATE TABLE market_metrics (
  id SERIAL PRIMARY KEY,
  county VARCHAR(50),
  city VARCHAR(100),
  period_date DATE, -- first day of month/week
  period_type VARCHAR(20), -- daily/weekly/monthly
  property_type VARCHAR(50),
  median_price DECIMAL(15, 2),
  avg_price DECIMAL(15, 2),
  avg_price_per_sqft DECIMAL(10, 2),
  active_listings INTEGER,
  new_listings INTEGER,
  closed_sales INTEGER,
  avg_days_on_market DECIMAL(10, 1),
  inventory_depth DECIMAL(10, 1), -- months of supply
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Alerts/Watchlist
CREATE TABLE watchlist (
  id SERIAL PRIMARY KEY,
  user_id INTEGER, -- for future multi-user support
  property_id INTEGER REFERENCES properties(id),
  notes TEXT,
  alert_on_price_drop BOOLEAN DEFAULT FALSE,
  alert_price_threshold DECIMAL(15, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Phase 4: Implementation Roadmap

*(Revised 2026-08-14 for the Cadastral-API-first, aggregate-only strategy — see Phase 1 Findings above.)*

### Week 1: Cadastral API Client + Schema ✅ Done (2026-08-14)
- [x] Set up Node.js project (Express, node-cron — no axios needed, native `fetch` covers it)
- [x] Build a paginated client for `msdi_cadastral_map_v1/MapServer/1` (handle the 2,000-record/query cap via `resultOffset`) — `backend/src/ingestion/cadastral.js`
- [x] Query Flathead County (`CountyName='Flathead'`), validate field mapping against the schema in Phase 3
- [x] Confirm the same client works unmodified against the other 5 target counties — verified exact `CountyName` spelling for all 6 (note: **"Lewis and Clark"**, not "Lewis & Clark" — the latter returns 0 rows)

**Deliverable:** Working Cadastral API client returning clean JSON for all 6 counties — done

---

### Week 2: Database Setup & Data Ingestion ✅ Done (2026-08-14)
- [x] Postgres+PostGIS via `docker-compose.yml` (`postgis/postgis:16-3.4`), deployed through Portainer as a Git-based stack
- [x] Create schema from Phase 3 (trimmed to `properties`, `market_metrics`, `watchlist`) — `db/schema.sql`, auto-applied on first container start
- [x] Build insertion pipeline (paginate API → upsert on `parcel_id` in batches of 500) — `backend/src/ingestion/loadToDb.js`
- [x] Store `Shape` geometry directly via `ST_GeomFromGeoJSON` — no separate geocoding step needed
- [x] Automated ingestion: full 6-county run on first backend boot if `properties` is empty, plus a monthly cron (`0 3 1 * *`, matching the Cadastral data's own update cadence) — `backend/src/server.js`

**Deliverable:** All 6 counties' parcel/ownership/assessed-value data in PostgreSQL, automated ingestion working — done. (~355k parcels total across the 6 counties per live API counts: Flathead 83,857 / Yellowstone 83,645 / Missoula 60,689 / Gallatin 53,617 / Lewis and Clark 40,208 / Ravalli 33,216.)

---

### Week 3: Aggregate Market Metrics Ingestion ✅ Done, revised scope (2026-08-15)
- [x] Researched Montana's realtor board/MLS landscape: no free, structured, ToS-clean feed covers all 56 counties — coverage is a patchwork of ~9 populous-county boards each publishing their own monthly PDF/dashboard (different formats, no API, no archive), everything else has no board at all. Real median-*sale*-price/DOM/listing data would mean a human re-reading PDFs every month indefinitely, for a minority of counties.
- [x] **Decision:** skip the manual-report route. Instead, `market_metrics` is populated automatically from data we already have — median/average **assessed** value per county, computed directly from `properties` (`backend/src/ingestion/computeMarketMetrics.js`), refreshed at the end of every ingestion run (startup gap-fill, monthly cron, or manual trigger). All 56 counties, zero ongoing maintenance, always as fresh as the last ingestion — the honest tradeoff being assessed value (what DOR has on record) rather than a real transaction/listing price, which is true of every free county-complete source that exists for Montana (Census ACS, MT DOR's own report), not a shortcut unique to this approach.
- [x] Frontend updated to represent this honestly — section relabeled "Assessed Value Trends," listing-specific columns (active/new listings, closed sales, DOM) removed rather than left permanently blank, explicit "not a sale price" note added to the UI itself, not just code comments

**Deliverable:** `market_metrics` auto-populated for all 56 counties — done, with a materially different (and more honest, given what's actually available) shape than originally scoped.

---

### Week 4-5: Frontend Dashboard v1 ✅ Done (2026-08-14)
- [x] Set up React project (Vite) — `frontend/`
- [x] Build REST API endpoints:
  - `GET /api/counties` — list all counties with summary stats
  - `GET /api/properties?county=&q=&property_type=&min_value=&max_value=&page=` — filtered, paginated parcel search
  - `GET /api/properties/:id` — detailed property view (owner, assessed value, geometry)
  - `GET /api/market-metrics/:county` — aggregate price/inventory trends (empty until Week 3)
- [x] Dashboard layout:
  - County selector (cards with parcel count + total assessed value)
  - Interactive parcel map (Leaflet, `CircleMarker`s at parcel centroids, colored by assessed value bucket)
  - Property search (by address, owner name, or parcel number)
  - Property detail view (full parcel info + assessed value breakdown)
  - Market summary panel (aggregate trend chart per county, sourced from Week 3 data)
- [x] Connect frontend to backend API (nginx reverse-proxies `/api/*` to the `backend` container — same-origin from the browser, no CORS setup needed; `vite.config.js` dev proxy mirrors this locally)
- [x] Deploy — **revised from the original Vercel plan**: this is now one `docker-compose.yml` (db + backend + frontend containers) deployed as a single Portainer stack pulled from this GitHub repo, per your call to make this "an all in one docker website" rather than split across Vercel + a separate DB host

**Deliverable:** Live dashboard accessible at deployed URL — a parcel/ownership/assessed-value explorer with aggregate market context, not a listings site. **Status: deployed and live** on Portainer (db + backend + frontend, one stack).

**Post-launch scope growth (2026-08-15), not in the original Weeks 1-5 plan:**
- Expanded coverage from the original 6 counties to **all 56 Montana counties** (~920k raw parcels, ~886k after excluding null-PARCELID filler geometry) — trivial given the Cadastral API is already statewide; just a `TARGET_COUNTIES` config change
- Replaced fixed "top-200-by-value per county" map/table queries with **viewport-based querying** — results now scope to the map's actual bounding box (`geom && ST_MakeEnvelope(...)`, GIST-indexed), and the county selector became a dropdown with an "All Counties" option, since neither the old card-row selector nor value-sorted-only queries hold up at statewide scale
- A round of production hardening after first deploy: idle-pool crash fix, per-row ingestion fault isolation + retry (a bad batch no longer aborts an entire county, a failed county no longer aborts the rest of the run), self-healing startup (restarts fill in whatever's missing instead of silently sitting incomplete), token-gated manual/per-county re-ingest endpoints, tightened container port exposure, a parameter-array mutation bug in the properties list query, and a `levy_district` column too narrow for how some counties (Granite, Stillwater) format that field
- `backend/src/ingestion/verify.js` — compares actual DB row counts per county against a live re-count from the Cadastral API, for ongoing data-completeness checks

---

### Week 6+: Iteration & Advanced Features
- [x] **Ownership analysis** ✅ Done (2026-08-15) — `GET /api/ownership/summary?county=` (`backend/src/routes/ownership.js`) returns top multi-parcel owners, an out-of-state-vs-Montana residency breakdown, and an LLC/Trust/Corp/Partnership/Government/Individual breakdown, all derived via text-pattern matching on `owner_name`/`owner_state` — no new data needed, works per-county or statewide. New `OwnershipInsights` frontend section, always visible (unlike Assessed Value Trends, this is meaningful even under "All Counties"). Explicitly labeled as heuristic, not an authoritative classification, since the source data has no structured owner-type field.
- [x] **Assessed-value heatmap** ✅ Done (2026-08-15) — toggle button on the map (`frontend/src/components/PropertyMap.jsx`) switches between the existing marker view and a `leaflet.heat` density overlay weighted by assessed value *per acre* (not raw total value — normalizes for a $2M/500-acre ranch vs. a $300k/0.2-acre in-town lot meaning very different things). Log-transformed and normalized to the currently-loaded dataset's own range so extreme per-acre outliers (tiny urban lots) don't wash out the gradient. No backend changes — computed client-side from data the map already has.
- [ ] **Year-over-year assessment change tracking** — snapshot `TotalValue` each ingestion run, chart drift over time. Low priority for now: Montana reappraises on a 2-year cycle, so there's not much of a "trend" to show until multiple cycles of history accumulate
- [x] **Export** ✅ Done (2026-08-15) — `GET /api/properties/export` (same filters as the list endpoint: county/bbox/search/type/value range), streams up to 50,000 matching rows as CSV. "Export CSV" button next to the result count, reflects whatever's currently filtered/in view
- [ ] **Mobile Responsiveness** — one CSS breakpoint added, not tested on an actual device
- [x] **Performance (partial)** — geometry (GIST) and `total_value` indexes added; no caching layer yet
- [ ] **Revisit listings/sold-price data** — only via a legitimate path (paid IDX/data vendor), if still wanted, per the Phase 1 decision
- [x] **Frontend stale-response guard** ✅ Done (2026-08-15) — `AbortController` on the properties-list and property-detail fetches in `App.jsx`; each effect/callback aborts its own previous in-flight request before starting a new one, so an out-of-order (slower-but-older) response can no longer overwrite a newer one
- [x] **DB migration tooling** ✅ Done (2026-08-15) — `backend/db/migrations/*.sql` + `backend/src/db/migrate.js`, applied automatically on every backend startup (tracked in `schema_migrations`, already-applied files skipped) rather than relying on Postgres's docker-entrypoint-initdb.d (which only ever runs once, on an empty volume — the actual root cause of both the original schema-never-applied incident and needing to hand-run the two follow-up fixes). `db` reverted to a plain `postgis/postgis` image now that schema setup doesn't depend on it; `db/schema.sql` and `db/Dockerfile` removed, consolidated into `backend/db/migrations/001_initial_schema.sql`

**Deliverable:** Enhanced dashboard with additional features and analytics

---

## Phase 5: Quick Win v1 Deliverables

*(Revised 2026-08-14 — see Phase 1 Findings for why listings/sold-price were descoped.)*

Aim for this first release (Weeks 1-5):

### Data
- ✅ 6 Montana counties' parcel records (owner, address, assessed value, acreage, geometry) — from the statewide Cadastral API
- ✅ Aggregate market trend data (median price, DOM, inventory) per county — from local realtor board reports
- ❌ ~~Per-property listing/sold data~~ — descoped (non-disclosure state + no scrapeable MLS access; see Phase 1 Findings)

### Dashboard Features
- ✅ County selector
- ✅ Interactive parcel map (colored by assessed value/property type)
- ✅ Property search (by address, owner name, or parcel number)
- ✅ Property detail view (owner, assessed value breakdown, acreage, geometry)
- ✅ Market summary (aggregate trend chart per county)
- ❌ ~~Recent listings table~~ / ❌ ~~price-on-map~~ — descoped, v2+ if a legitimate data source is secured

### No Auth
- Public site, no login required
- Read-only access to all data

---

## Phase 6: Data Sources (Specific Examples)

### Flathead County
- **Assessor:** https://flathead.mt.gov/ (check for searchable GIS/assessor portal)
- **County Clerk Deeds:** Searchable online through Flathead County Clerk office
- **GIS Data:** May have open parcel shapefile download
- **Note:** Validate URLs during Phase 1 research

### Gallatin County (Bozeman)
- **Assessor:** Check gallatin.mt.gov
- **Active MLS market:** Good for Zillow/Redfin scraping
- **Bozeman is hot market:** More recent sales for trend data

### Missoula County
- **Assessor & Deeds:** missoula.mt.gov
- **College town:** Unique market dynamics

### Yellowstone County (Billings)
- **Assessor:** yellowstone.mt.gov
- **Largest city in Montana:** Most active market

### Lewis & Clark County (Helena)
- **Assessor:** lewis-clark.mt.gov
- **State capital:** Stable, established market

### Ravalli County (Hamilton)
- **Assessor:** ravalli.mt.gov
- **Smaller emerging market:** Good for tracking growth

**Note:** All URLs are examples and should be verified during Phase 1 research.

---

## Effort Estimate

| Phase | Task | Hours | Notes |
|-------|------|-------|-------|
| 1 | Data Source Research | 5-10 | 1-2 hours per county |
| 2 | Scraper Build (Flathead) | 20-30 | Learning curve + debugging |
| 3 | DB Setup & Ingestion | 15-20 | Schema, geocoding, automation |
| 4 | Multi-County Scale | 10-15 | Adapt for other counties |
| 5-6 | Frontend Dashboard | 30-40 | API, UI, deployment |
| 7+ | Advanced Features | 20-30 | Alerts, heatmaps, analysis |
| **Total** | | **100-145 hours** | 2-3 months part-time |

---

## Success Metrics

By end of v1:
- ✅ 6 counties' data scraped and updated automatically
- ✅ Dashboard loads in <2 seconds
- ✅ 10,000+ properties indexed
- ✅ Historical price data for 6+ months
- ✅ Useful market insights visible (trends, hot areas, price ranges)
- ✅ Mobile-responsive interface

---

## Next Step

**Start with Phase 1:**
1. Pick Flathead County
2. Spend 1-2 hours finding:
   - Assessor website URL
   - GIS data portal
   - County Clerk deed records access
   - Whether bulk downloads exist or if HTML scraping is needed
3. Document findings
4. Screenshot key pages

Once Phase 1 is done, we can map out exact scraper logic.

---

## Phase 8: MCP Server Integration ✅ Done (2026-08-15)

You asked to add "anything MCP related" to this project (fitting, given it lives under
`Apps/MCP/`). Exposes the same parcel/ownership/assessed-value data the dashboard shows
as **MCP tools**, so Claude (Desktop or Code) can query it directly in natural language —
"which parcels in Ravalli County are owned by out-of-state LLCs", "total assessed value
across Gallatin County vacant land" — without the dashboard's fixed UI in the way.

### What was built
- `mcp-server/` — 4th service in `docker-compose.yml`, `profiles: ["mcp"]` (not started by
  a plain `docker compose up`; opt in with `docker compose --profile mcp up` once
  `MCP_TOKEN` is set — this keeps it from blocking a default deploy for anyone not using it)
- Node.js + `@modelcontextprotocol/sdk` (v1.30), **Streamable HTTP transport in stateless
  mode** (a fresh `McpServer` + transport per request, no session tracked between calls —
  simpler and more robust than the stateful session-map pattern for a tool-calling server
  with no server-initiated notifications). Verified against the live SDK by reading its
  own bundled reference example (`examples/server/simpleStatelessStreamableHttp.js`)
  rather than relying on possibly-stale memory of the API, and by sending real JSON-RPC
  `initialize`/`tools/list`/`tools/call` requests against a running instance to confirm
  the protocol handshake, tool schemas, and error handling all work correctly
- Published directly to the host on port 3100 (unlike `db`/`backend`, there's no nginx in
  front of it — the whole point of choosing remote transport is being reachable from
  wherever you run Claude). `MCP_TOKEN` bearer-auth is required — the server refuses to
  start at all if it's unset, rather than running with no auth
- Reads from the same Postgres DB as `backend` (same `PG*` env vars)

### Tools (all read-only)
- `list_counties`, `search_properties`, `get_property`, `get_market_metrics`,
  `find_multi_parcel_owners` — same surface as originally planned, matching what the REST
  API and dashboard expose

### Deviations from the original plan (deliberate, not oversights)
- **Own SQL, not shared with `backend/src/routes/*.js`.** The original plan proposed
  extracting query logic into a shared `backend/src/db/queries.js`. At 5 tools, that
  coupling wasn't worth it yet — this is a separate service with its own trust boundary
  and looser (LLM-driven) input shapes; duplicating a handful of queries is simpler than
  introducing a shared module both services depend on. Worth revisiting if the tool count
  grows enough that the duplication actually hurts.
- **Reuses `backend`'s full DB credentials rather than a dedicated read-only Postgres
  role.** The original plan called for `SELECT`-only grants. Not yet done — the MCP tools
  only ever issue read queries in practice, but nothing at the database level currently
  enforces that. Worth doing as a follow-up hardening step (`CREATE ROLE mcp_readonly ...
  GRANT SELECT ON properties, market_metrics TO mcp_readonly`), especially before pointing
  this at anything more sensitive than public parcel records.

### How to connect a client
```bash
# In Portainer, redeploy the stack with the mcp profile enabled and MCP_TOKEN set, then:
curl -X POST http://<host>:3100/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```
Add it to Claude Desktop/Code as a remote MCP server pointed at `http://<host>:3100/mcp`
with the `Authorization: Bearer <token>` header configured.

---

## Notes & Assumptions

- **Free data only** — No paid APIs or data services
- **Public web scraping** — Only scraping publicly accessible pages
- **Single developer** — You, part-time
- **No existing infrastructure** — Starting from scratch
- **Montana focus** — 6 counties as pilot; can expand later
- **Basic auth** — No user logins in v1
- **Open data philosophy** — All scraped data is public records

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| County websites change format | Build flexible parsing, add error logging |
| Rate limiting/blocks on scraping | Add delays between requests, rotate user agents |
| Geocoding failures | Use fallback (manual lat/long for failed addresses) |
| Data quality issues | Validation layer, manual spot-checks, user reports |
| Database performance | Proper indexing, query optimization, caching |
| Scope creep | Stick to v1 scope, defer nice-to-haves to v2 |

---

## Glossary

- **Assessor Data** — Property records, ownership, assessed values (updated annually/semi-annually)
- **Deed Records** — Official property sales/transfers recorded at county level
- **MLS** — Multiple Listing Service (real estate listings, mostly from brokers)
- **Parcel ID** — Unique identifier for a property plot
- **Price per Sqft** — Sale price ÷ building square footage (common comparison metric)
- **Days on Market (DOM)** — How long a listing was active before selling
- **PostGIS** — PostgreSQL geographic extension (enables spatial queries like distance, boundaries)
- **Geocoding** — Converting addresses to latitude/longitude coordinates

---

**Created:** [Today's Date]
**Status:** Planning Phase
**Last Updated:** [Today's Date]
