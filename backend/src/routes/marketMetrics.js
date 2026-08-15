import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

// GET /api/market-metrics/:county — aggregate trend series (median price, DOM, inventory).
// Rows can be either self-computed (median/avg ASSESSED value, every county, always
// available — see computeMarketMetrics.js) or, where a FRED series exists for the county
// (populous counties only), real median LISTING price/active listings/days on market via
// FRED (see fredMarketData.js). Distinguish by `source`. Neither is a sale price — see
// the plan doc's Phase 1 Findings for why (Montana non-disclosure law).
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
