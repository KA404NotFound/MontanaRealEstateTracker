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

**Decision needed from you before Phase 1 is "done."** See question below.

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

### Week 1: Data Source Audit
- [ ] Map out each county's data access (URL, format, frequency)
- [ ] Test if assessor sites are scrapeable or have bulk download options
- [ ] Document any API keys or special access requirements
- [ ] Create data source spreadsheet (County → Source → Access Method → Update Frequency)
- [ ] Note any terms of service/scraping restrictions

**Deliverable:** Data Source Inventory Document

---

### Week 2: Scraper v1 (Flathead County)
- [ ] Set up Node.js project with Express, Cheerio, axios
- [ ] Build HTML scraper for Flathead County assessor records
- [ ] Parse: address, parcel ID, owner, assessed value, property type
- [ ] Handle edge cases: missing data, malformed HTML, special characters
- [ ] Test on 100+ properties, validate data quality
- [ ] Document parsing logic for future county adaptations

**Deliverable:** Working scraper for Flathead County, sample data in JSON

---

### Week 3: Database Setup & Data Ingestion
- [ ] Set up PostgreSQL locally and on hosting (Render or similar)
- [ ] Create schema from Phase 3
- [ ] Build data insertion pipeline (validate → deduplicate → insert)
- [ ] Add geocoding (convert addresses to lat/long via Nominatim or similar)
- [ ] Handle updates (detect changes, update timestamps)
- [ ] Build logging/monitoring for scraper health
- [ ] Set up automated daily/weekly cron job

**Deliverable:** Flathead County data in PostgreSQL, automated ingestion working

---

### Week 4: Scale to Other Counties
- [ ] Audit each county's data format (may differ from Flathead)
- [ ] Build modular scraper functions (one per county as needed)
- [ ] Adapt HTML parsing for county-specific variations
- [ ] Consolidate scrapers into single codebase
- [ ] Run initial bulk load for all 5-6 counties
- [ ] Validate data consistency across counties

**Deliverable:** All 6 counties' assessor data in database

---

### Week 5-6: Frontend Dashboard v1
- [ ] Set up React project (create-react-app or Vite)
- [ ] Build REST API endpoints:
  - `GET /api/counties` — list all counties with summary stats
  - `GET /api/listings?county=&property_type=` — filtered listings
  - `GET /api/properties/:id` — detailed property view
  - `GET /api/market-metrics/:county` — price trends
- [ ] Dashboard layout:
  - County selector (dropdown or tabs)
  - Recent listings table (address, price, date, status)
  - Price trend chart (median price over time)
  - Map showing active listings
  - Property search (by address/parcel number)
- [ ] Connect frontend to backend API
- [ ] Deploy frontend to Vercel

**Deliverable:** Live dashboard accessible at deployed URL

---

### Week 7+: Iteration & Advanced Features
- [ ] **Alerts** — Email/SMS when new listing matches criteria or price drops
- [ ] **Heatmap** — Visualize price per sqft by neighborhood
- [ ] **Seller/Buyer Analysis** — Identify investor activity, corporate purchases
- [ ] **Price Predictions** — Train simple ML model on historical sales
- [ ] **Export** — Download filtered results as CSV
- [ ] **Mobile Responsiveness** — Ensure dashboard works on phones
- [ ] **Performance** — Add database indexes, caching for fast queries

**Deliverable:** Enhanced dashboard with additional features and analytics

---

## Phase 5: Quick Win v1 Deliverables

Aim for this first release (Weeks 1-6):

### Data
- ✅ 6 Montana counties' assessor records (property details, assessed values)
- ✅ Recent sales data (last 12 months from county deeds)
- ✅ Zillow/Redfin scrape (active listings, price history)

### Dashboard Features
- ✅ County selector
- ✅ Recent listings table (address, price, days on market, status)
- ✅ Price trend chart (median/average price over time per county)
- ✅ Interactive map (markers for active listings, color by price range)
- ✅ Property search (by address, parcel number, or price range)
- ✅ Property detail view (full info, price history, image)
- ✅ Market summary (active listings, closed sales, days on market per county)

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
