
import { Router } from "express";
import { pool } from "./db.js";

const router = Router();

// Create a quota for a user
router.post("/", async (req, res) => {
  const { userId, quotaLimit, periodStart, periodEnd } = req.body;

  if (
    !Number.isInteger(userId) ||
    userId <= 0 ||
    !Number.isSafeInteger(quotaLimit) ||
    quotaLimit < 0 ||
    typeof periodStart !== "string" ||
    typeof periodEnd !== "string" ||
    !Number.isFinite(Date.parse(periodStart)) ||
    !Number.isFinite(Date.parse(periodEnd)) ||
    Date.parse(periodEnd) <= Date.parse(periodStart)
  ) {
    res.status(400).json({
      error: "Valid userId, quotaLimit, periodStart, and periodEnd are required",
    });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO quotas (user_id, quota_limit, period_start, period_end)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, quota_limit, period_start, period_end`,
      [userId, quotaLimit, periodStart, periodEnd],
    );

    res.status(201).json({ quota: result.rows[0] });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23503"
    ) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    console.error("Failed to create quota:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get quotas for a user
router.get("/:userId", async (req, res) => {
  const userId = Number(req.params.userId);

  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, user_id, quota_limit, period_start, period_end
       FROM quotas
       WHERE user_id = $1
       ORDER BY period_start DESC`,
      [userId],
    );

    res.json({ quotas: result.rows });
  } catch (error) {
    console.error("Failed to fetch quotas:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
