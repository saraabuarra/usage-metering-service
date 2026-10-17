import { Router } from "express";
import { pool } from "./db.js";

const router = Router();

// Record usage for a user
router.post("/", async (req, res) => {
  const { userId, quantity, idempotencyKey } = req.body;

  if (
    !Number.isInteger(userId) ||
    userId <= 0 ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    (idempotencyKey !== undefined &&
      (typeof idempotencyKey !== "string" ||
        idempotencyKey.trim().length === 0))
  ) {
    res.status(400).json({
      error: "A valid userId, positive quantity, and optional idempotencyKey are required",
    });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      "SELECT id FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );

    if (userResult.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (idempotencyKey !== undefined) {
      const existing = await client.query(
        `SELECT id, user_id, quantity, recorded_at
         FROM usage_records
         WHERE idempotency_key = $1`,
        [idempotencyKey.trim()],
      );

      if (existing.rowCount && existing.rows[0].user_id === userId) {
        await client.query("COMMIT");
        res.status(200).json({
          usage: existing.rows[0],
          duplicate: true,
        });
        return;
      }

      if (existing.rowCount) {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: "Idempotency key already used",
        });
        return;
      }
    }

    const quotaResult = await client.query(
      `SELECT id, quota_limit
       FROM quotas
       WHERE user_id = $1
         AND period_start <= NOW()
         AND period_end > NOW()
       ORDER BY period_start DESC
       LIMIT 1
       FOR UPDATE`,
      [userId],
    );

    if (quotaResult.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(409).json({
        error: "No active quota configured for this user",
      });
      return;
    }

    const quota = quotaResult.rows[0];

    const usageResult = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::text AS total
       FROM usage_records
       WHERE user_id = $1
         AND recorded_at >= (
           SELECT period_start FROM quotas WHERE id = $2
         )
         AND recorded_at < (
           SELECT period_end FROM quotas WHERE id = $2
         )`,
      [userId, quota.id],
    );

    const currentUsage = BigInt(usageResult.rows[0].total);
    const limit = BigInt(quota.quota_limit);

    if (currentUsage + BigInt(quantity) > limit) {
      await client.query("ROLLBACK");
      res.status(429).json({
        error: "Quota exceeded",
        currentUsage: currentUsage.toString(),
        quotaLimit: limit.toString(),
      });
      return;
    }

    const result = await client.query(
      `INSERT INTO usage_records (user_id, quantity, idempotency_key)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, quantity, recorded_at`,
      [userId, quantity, idempotencyKey?.trim() ?? null],
    );

    await client.query("COMMIT");

    res.status(201).json({
      usage: result.rows[0],
      totalUsage: (currentUsage + BigInt(quantity)).toString(),
      quotaLimit: limit.toString(),
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Failed to record usage:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// Get usage records for a user
router.get("/:userId", async (req, res) => {
  const userId = Number(req.params.userId);

  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, user_id, quantity, recorded_at
       FROM usage_records
       WHERE user_id = $1
       ORDER BY recorded_at DESC`,
      [userId],
    );

    res.json({ usage: result.rows });
  } catch (error) {
    console.error("Failed to fetch usage:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
