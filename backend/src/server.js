import express from "express";
import cors from "cors";
import cron from "node-cron";
import { pool } from "./db/pool.js";
import { describeError } from "./lib/describeError.js";
import { ingestAllCounties, TARGET_COUNTIES } from "./ingestion/runAll.js";
import { loadCountyToDb } from "./ingestion/loadToDb.js";
import countiesRouter from "./routes/counties.js";
import propertiesRouter from "./routes/properties.js";
import marketMetricsRouter from "./routes/marketMetrics.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (err) {
    // Plain err.message is blank for the AggregateError a failed pg connection throws by
    // default (see lib/describeError.js) — exactly the case this endpoint exists to report.
    res.status(503).json({ status: "db unavailable", error: describeError(err) });
  }
});

app.use("/api/counties", countiesRouter);
app.use("/api/properties", propertiesRouter);
app.use("/api/market-metrics", marketMetricsRouter);

let ingestionInProgress = false;

// Full re-ingestion is expensive (20-40+ min, hammers both the Cadastral API and the DB),
// so unlike the read-only endpoints, this one requires a shared-secret token rather than
// being open like the rest of the no-auth v1 API. Set INGEST_TOKEN in the environment to
// enable it; leaving it unset disables the endpoint entirely (fails closed).
const INGEST_TOKEN = process.env.INGEST_TOKEN;

// POST /api/ingest — manually (re)trigger a full ingestion run. Fire-and-forget: a full
// 6-county pull is ~355k parcels and can take 20-40+ minutes, so this responds
// immediately and logs progress to stdout (visible in `docker logs` / Portainer).
app.post("/api/ingest", (req, res) => {
  if (!INGEST_TOKEN) {
    return res.status(503).json({ error: "ingest endpoint disabled — set INGEST_TOKEN to enable" });
  }
  const auth = req.get("authorization") || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (provided !== INGEST_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (ingestionInProgress) {
    return res.status(409).json({ status: "already running" });
  }
  ingestionInProgress = true;
  res.json({ status: "started", counties: TARGET_COUNTIES });
  ingestAllCounties(pool)
    .catch((err) => console.error("Ingestion failed:", err))
    .finally(() => {
      ingestionInProgress = false;
    });
});

// POST /api/ingest/:county — re-ingest a single county. Same auth as the full-run
// endpoint above, but scoped — useful for re-running just the counties affected by a
// fix (e.g. a schema change) without waiting for a full ~56-county run to redo
// everything. County names with spaces need URL-encoding, e.g. "Lewis%20and%20Clark".
app.post("/api/ingest/:county", (req, res) => {
  if (!INGEST_TOKEN) {
    return res.status(503).json({ error: "ingest endpoint disabled — set INGEST_TOKEN to enable" });
  }
  const auth = req.get("authorization") || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (provided !== INGEST_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const { county } = req.params;
  if (!TARGET_COUNTIES.includes(county)) {
    return res.status(400).json({ error: `unrecognized county: ${county}` });
  }
  if (ingestionInProgress) {
    return res.status(409).json({ status: "already running" });
  }
  ingestionInProgress = true;
  res.json({ status: "started", county });
  loadCountyToDb(pool, county, { log: console.log })
    .then(({ loaded, failed }) =>
      console.log(`${county} County re-ingest complete: ${loaded} upserted${failed ? `, ${failed} skipped` : ""}.`)
    )
    .catch((err) => console.error(`${county} County re-ingest failed:`, err))
    .finally(() => {
      ingestionInProgress = false;
    });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});

const PORT = process.env.PORT || 3000;

async function waitForDb(retries = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      console.log(`Waiting for database (attempt ${attempt}/${retries})...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("Database never became reachable");
}

app.listen(PORT, async () => {
  console.log(`API listening on port ${PORT}`);

  try {
    await waitForDb();

    console.log(
      "Checking for counties missing data (self-healing: a container restart after a " +
        "partial/failed run will pick up wherever ingestion left off)..."
    );
    ingestionInProgress = true;
    ingestAllCounties(pool, { onlyMissing: true })
      .catch((err) => console.error("Startup gap-fill ingestion failed:", err))
      .finally(() => {
        ingestionInProgress = false;
      });
  } catch (err) {
    console.error("Startup DB check failed:", err);
  }

  // The Cadastral dataset itself is republished monthly — re-ingest on the 1st at 3am.
  cron.schedule("0 3 1 * *", () => {
    if (ingestionInProgress) {
      console.log("Scheduled ingestion skipped — a run is already in progress.");
      return;
    }
    console.log("Monthly scheduled ingestion starting...");
    ingestionInProgress = true;
    ingestAllCounties(pool)
      .catch((err) => console.error("Scheduled ingestion failed:", err))
      .finally(() => {
        ingestionInProgress = false;
      });
  });
});
