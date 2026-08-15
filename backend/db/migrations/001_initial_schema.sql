-- Montana Multi-County Real Estate Tracker — baseline schema.
-- Scope matches the Phase 1 decision in Montana_Real_Estate_Tracker_Plan.md:
-- parcel/ownership/assessed-value data (from the statewide Cadastral API) +
-- aggregate market trend data. No per-listing or sale-price tables in v1 —
-- Montana is a non-disclosure state and MLS data isn't a legitimate free
-- source (see Phase 1 Findings for detail).
--
-- Consolidates what was originally applied in three separate manual steps
-- (initial schema, widening levy_district, adding the total_value index) into
-- one baseline now that migrations track schema state going forward. Every
-- statement here is idempotent (IF NOT EXISTS throughout), so replaying this
-- against an already-migrated database is a safe no-op.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS properties (
  id                     SERIAL PRIMARY KEY,
  parcel_id              VARCHAR(50) UNIQUE NOT NULL,
  county                 VARCHAR(50) NOT NULL,
  owner_name             VARCHAR(255),
  owner_address_1        VARCHAR(255),
  owner_address_2        VARCHAR(255),
  owner_address_3        VARCHAR(255),
  owner_city             VARCHAR(100),
  owner_state             VARCHAR(2),
  owner_zip              VARCHAR(10),
  dba_name               VARCHAR(255),
  care_of_taxpayer       VARCHAR(255),
  address_line1          VARCHAR(255),
  address_line2          VARCHAR(255),
  city_state_zip         VARCHAR(100),
  property_type          VARCHAR(100),
  prop_access             VARCHAR(100),
  total_acres            DECIMAL(12, 4),
  total_land_value       INTEGER,
  total_building_value   INTEGER,
  total_value            INTEGER,
  tax_year               INTEGER,
  levy_district           VARCHAR(255), -- some counties (e.g. Granite, Stillwater) spell this out in full rather than a short code; observed max 62 chars statewide
  township                VARCHAR(20),
  range                   VARCHAR(20),
  section                  VARCHAR(20),
  subdivision              VARCHAR(255),
  geom                    GEOMETRY(Geometry, 4326),
  last_ingested_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_properties_county ON properties (county);
CREATE INDEX IF NOT EXISTS idx_properties_owner_name ON properties (owner_name);
CREATE INDEX IF NOT EXISTS idx_properties_geom ON properties USING GIST (geom);
-- Supports "ORDER BY total_value DESC ... LIMIT" without a full sort, which matters once
-- a query isn't narrowed much by county/bbox (e.g. "All Counties" zoomed out statewide).
CREATE INDEX IF NOT EXISTS idx_properties_total_value ON properties (total_value DESC NULLS LAST);

-- Aggregate market trend data. Two kinds of rows, distinguished by `source`: a
-- self-computed median/avg ASSESSED value snapshot (every county, always available —
-- see backend/src/ingestion/computeMarketMetrics.js) and, where a FRED series exists
-- (populous counties only), real median LISTING price/active listings/days on market
-- via FRED (see backend/src/ingestion/fredMarketData.js, added in migration 002 — this
-- table's shape predates that, hence the later ALTER to widen its unique constraint).
CREATE TABLE IF NOT EXISTS market_metrics (
  id                    SERIAL PRIMARY KEY,
  county                VARCHAR(50) NOT NULL,
  period_date           DATE NOT NULL,
  period_type           VARCHAR(20) NOT NULL, -- monthly/quarterly/annual
  source                VARCHAR(150),          -- e.g. "Computed from Cadastral assessed values" or "Realtor.com, via FRED (Federal Reserve Bank of St. Louis, fred.stlouisfed.org)"
  median_price          DECIMAL(15, 2),
  avg_price             DECIMAL(15, 2),
  active_listings       INTEGER,
  new_listings          INTEGER,
  closed_sales          INTEGER,
  avg_days_on_market    DECIMAL(10, 1),
  inventory_months      DECIMAL(10, 1),
  notes                 TEXT,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (county, period_date, period_type)
);

CREATE TABLE IF NOT EXISTS watchlist (
  id            SERIAL PRIMARY KEY,
  property_id   INTEGER REFERENCES properties(id) ON DELETE CASCADE,
  notes         TEXT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
