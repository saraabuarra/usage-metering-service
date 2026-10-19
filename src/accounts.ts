import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import { pool } from "./db.js";
import { requireApiKey } from "./auth.js";

const router = Router();

// Create an account and assign the predefined Starter plan.
router.post("/", async (req, res) => {
  const { name } = req.body ?? {};

  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Account name is required" });
    return;
  }

  const apiKey = randomBytes(32).toString("hex");
  const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const planResult = await client.query(
      `SELECT id FROM plans
       WHERE is_predefined = TRUE
         AND plan_type = 'account'
         AND name = 'Starter'`,
    );

    if (planResult.rows.length === 0) {
      throw new Error("Predefined Starter account plan not found");
    }

    const accountResult = await client.query(
      `INSERT INTO accounts (name, api_key_hash, account_plan_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, account_plan_id, created_at`,
      [name.trim(), apiKeyHash, planResult.rows[0].id],
    );

    await client.query("COMMIT");

    res.status(201).json({
      account: accountResult.rows[0],
      apiKey,
      message: "Save this API key now. It will not be returned again.",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Failed to create account:", error);
    res.status(500).json({ error: "Failed to create account" });
  } finally {
    client.release();
  }
});

// Get the authenticated account's details.
router.get("/me", requireApiKey, async (_req, res) => {
  try {
    const account = res.locals.account;

    const result = await pool.query(
      `SELECT a.id, a.name, a.created_at,
              p.name AS plan_name,
              p.monthly_allowance,
              p.max_units_per_request
       FROM accounts a
       JOIN plans p ON p.id = a.account_plan_id
       WHERE a.id = $1`,
      [account.id],
    );

    res.json({ account: result.rows[0] });
  } catch (error) {
    console.error("Failed to fetch account:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// Change the authenticated account's plan.
router.patch("/me/plan", requireApiKey, async (req, res) => {
  const planId = req.body?.planId;

  if (!Number.isSafeInteger(planId) || planId <= 0) {
    res.status(400).json({ error: "A valid planId is required" });
    return;
  }

  try {
    const accountId = res.locals.account.id;

    const planResult = await pool.query(
      `SELECT id FROM plans
       WHERE id = $1
         AND plan_type = 'account'
         AND (
           is_predefined = TRUE
           OR owner_account_id = $2
         )`,
      [planId, accountId],
    );

    if (planResult.rows.length === 0) {
      res.status(404).json({
        error: "Account plan not found or not available to this account",
      });
      return;
    }

    const result = await pool.query(
      `UPDATE accounts
       SET account_plan_id = $1
       WHERE id = $2
       RETURNING id, name, account_plan_id`,
      [planId, accountId],
    );

    res.json({
      message: "Account plan updated",
      account: result.rows[0],
    });
  } catch (error) {
    console.error("Failed to change account plan:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
export default router;
