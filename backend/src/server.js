import express from "express";
import cors from "cors";
import cron from "node-cron";
import { pool } from "./db/pool.js";
import { ingestAllCounties, TARGET_COUNTIES } from "./ingestion/runAll.js";
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
    res.status(503).json({ status: "db unavailable", error: err.message });
  }
});

app.use("/api/counties", countiesRouter);
app.use("/api/properties", propertiesRouter);
app.use("/api/market-metrics", marketMetricsRouter);

let ingestionInProgress = false;

// POST /api/ingest — manually (re)trigger a full ingestion run. Fire-and-forget: a full
// 6-county pull is ~355k parcels and can take 20-40+ minutes, so this responds
// immediately and logs progress to stdout (visible in `docker logs` / Portainer).
app.post("/api/ingest", (req, res) => {
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

    const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM properties");
    if (rows[0].count === 0) {
      console.log(
        "properties table is empty — starting initial ingestion in the background " +
          "(all 6 counties, ~355k parcels, expect 20-40+ minutes)..."
      );
      ingestionInProgress = true;
      ingestAllCounties(pool)
        .catch((err) => console.error("Initial ingestion failed:", err))
        .finally(() => {
          ingestionInProgress = false;
        });
    } else {
      console.log(`properties table already has ${rows[0].count} rows — skipping initial ingestion.`);
    }
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
