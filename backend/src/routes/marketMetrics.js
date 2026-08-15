import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

// GET /api/market-metrics/:county — aggregate trend series (median price, DOM, inventory).
// Empty until Phase 4 Week 3 (aggregate ingestion from local realtor board reports) is
// built — no per-listing/sale-price data exists in this system, see the plan doc.
router.get("/:county", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM market_metrics WHERE county = $1 ORDER BY period_date ASC`,
      [req.params.county]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
