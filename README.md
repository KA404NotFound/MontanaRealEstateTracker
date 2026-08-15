# Montana Multi-County Real Estate Tracker

Parcel/ownership/assessed-value explorer for 6 Montana counties (Flathead, Gallatin, Missoula,
Yellowstone, Lewis & Clark, Ravalli), built on Montana's statewide Cadastral API.

**Status:** early build. Ingestion client and database schema exist; API/frontend don't yet.
See [`Montana_Real_Estate_Tracker_Plan.md`](./Montana_Real_Estate_Tracker_Plan.md) for the
full roadmap, schema rationale, and — importantly — the Phase 1 Findings section explaining
why this scrapes one statewide API instead of 6 county sites, and why there's no per-listing
or sale-price data (Montana is a legal non-disclosure state for sale prices, and MLS data
requires a broker/IDX relationship, not something to build here as a hobby project).

## What's here right now

| Path | What it is |
|---|---|
| `backend/src/ingestion/cadastral.js` | Node client that pulls parcel data (owner, address, assessed value, acreage, geometry) for any Montana county from the statewide Cadastral REST API |
| `db/schema.sql` | Postgres+PostGIS schema — `properties`, `market_metrics`, `watchlist` |
| `docker-compose.yml` | Postgres+PostGIS stack, meant to be deployed via Portainer (Git-based stack) or run locally |
| `.env.example` | Template for the Postgres env vars the compose stack needs |

There's no REST API or frontend yet (that's Week 4-5 in the plan) — right now this repo is
data-layer only: you can pull parcel data and you have a database to put it in, but nothing
wires them together automatically yet.

## Running the database

**Via Portainer (how this is meant to be deployed):**
1. Stacks → Add stack → Repository, point at this repo/branch, compose path `docker-compose.yml`
2. In the stack's environment variables, set `POSTGRES_PASSWORD` (and optionally
   `POSTGRES_DB` / `POSTGRES_USER` if you don't want the defaults). Don't rely on
   `.env.example` — it's a template, not loaded automatically.
3. Deploy. `db/schema.sql` runs automatically on first container start (Postgres only runs
   files in `/docker-entrypoint-initdb.d/` when the data volume is empty).

**Locally with Docker Compose:**
```bash
cp .env.example .env   # then edit POSTGRES_PASSWORD
docker compose up -d
```

## Running the ingestion client

No install step needed — it only uses Node's built-in `fetch`, no dependencies.

```bash
cd backend
node src/ingestion/cadastral.js Flathead   # county name must match Cadastral's CountyName field exactly
```

This prints progress per 2,000-record page and dumps a sample record at the end. It doesn't
write to the database yet — that's the next piece to build (a small script that takes this
output and upserts into `properties` on `parcel_id`).

## Next steps

See "Phase 4: Implementation Roadmap" in the plan doc — next up is wiring the ingestion
client into the database (Week 2), then aggregate market-metrics ingestion (Week 3), then
the API/frontend (Week 4-5).
