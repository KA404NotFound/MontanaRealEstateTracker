# Montana Multi-County Real Estate Tracker

Parcel/ownership/assessed-value explorer for 6 Montana counties (Flathead, Gallatin, Missoula,
Yellowstone, Lewis & Clark, Ravalli), built on Montana's statewide Cadastral API.

See [`Montana_Real_Estate_Tracker_Plan.md`](./Montana_Real_Estate_Tracker_Plan.md) for the
full roadmap, schema rationale, and — importantly — the Phase 1 Findings section explaining
why this pulls from one statewide API instead of scraping 6 county sites, and why there's no
per-listing or sale-price data (Montana is a legal non-disclosure state for sale prices, and
MLS data requires a broker/IDX relationship — not something to build here as a hobby project).

## Architecture

Three containers, one `docker-compose.yml`:

| Service | What it is | Host port |
|---|---|---|
| `db` | Postgres 16 + PostGIS, schema auto-applied on first start | not published — reachable only from `backend` over the compose network |
| `backend` | Express API + the Cadastral ingestion job | not published — reachable only through `frontend`'s nginx proxy |
| `frontend` | Vite/React dashboard, built and served via nginx (which also proxies `/api/*` to `backend`) | 8080 (→ nginx 80) |

Only `frontend` is exposed to the host/internet — `db` and `backend` are reachable only over
the internal compose network. (If you need direct `psql` or API access for debugging,
temporarily uncomment the commented-out `ports:` line for that service in
`docker-compose.yml`.)

**Ingestion:** on every boot, the backend checks per-county row counts and ingests any of
the 6 target counties that are missing data (self-healing — if a previous run died partway
through, the next restart picks up where it left off rather than silently sitting on
partial coverage). A full refresh of all 6 counties also runs monthly via cron, matching
how often the Cadastral dataset itself is republished.

A manual full re-ingest is available at `POST /api/ingest`, but it's gated behind an
`INGEST_TOKEN` — set that env var and pass it as `Authorization: Bearer <token>`, e.g.:
```bash
curl -X POST -H "Authorization: Bearer $INGEST_TOKEN" http://<host>:8080/api/ingest
```
Leaving `INGEST_TOKEN` unset disables the endpoint entirely (it's the one state-changing,
expensive endpoint in an otherwise no-auth-by-design v1 — see the plan doc's Phase 5 notes
on why the rest of the API has no auth).

## Running it

**Via Portainer (how this is meant to be deployed):**
1. Stacks → Add stack → Repository, point at this repo/branch, compose path `docker-compose.yml`
2. In the stack's environment variables, set `POSTGRES_PASSWORD` (and optionally
   `POSTGRES_DB` / `POSTGRES_USER` if you don't want the defaults `montana_real_estate` /
   `mret`). Don't rely on `.env.example` — it's a template, not loaded automatically.
3. Deploy. Watch the `backend` container logs — first boot kicks off ingestion for all 6
   counties, which takes roughly 20-40 minutes depending on the host.
4. Visit `http://<host>:8080` once ingestion has populated at least one county.

**Locally with Docker Compose:**
```bash
cp .env.example .env   # then edit POSTGRES_PASSWORD
docker compose up -d --build
```
Then open `http://localhost:8080`.

**Frontend/backend dev loop (no Docker), against a running `db` container:**
```bash
# terminal 1
cd backend && npm install && npm start
# terminal 2
cd frontend && npm install && npm run dev
```
`vite.config.js` proxies `/api` to `http://localhost:3000` in dev, mirroring what nginx does
in production, so the frontend code doesn't need to know which mode it's running in.

## What the dashboard shows (v1 scope)

- County selector with per-county parcel counts and total assessed value
- Parcel search (owner name, address, parcel ID) within a county, paginated
- Interactive map (parcel centroids, colored by assessed value)
- Property detail panel (owner, mailing address, assessed value breakdown, acreage, legal
  description) on click
- Market Trends panel per county — **empty until aggregate market-report ingestion (Phase 4
  Week 3) is built**; this is intentionally separate from parcel data, sourced from local
  realtor board reports, not from listings/deeds (see Phase 1 Findings for why)

## Running the ingestion client standalone

Useful for testing against a single county without touching the DB:
```bash
cd backend
node src/ingestion/cadastral.js Flathead
```

## Next steps

See "Phase 4: Implementation Roadmap" in the plan doc — next up is aggregate market-metrics
ingestion (Week 3), then the "Phase 8: MCP Server" section for exposing this data to Claude
directly.
