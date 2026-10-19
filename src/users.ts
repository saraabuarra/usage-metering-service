import { Router } from "express";
import { pool } from "./db.js";
import { requireApiKey } from "./auth.js";

const router = Router();

router.use(requireApiKey);

// Create a user under the authenticated account.
router.post("/", async (req, res) => {
  const { name, email } = req.body ?? {};
  const accountId = res.locals.account.id as number;

  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof email !== "string" ||
    !email.trim()
  ) {
    res.status(400).json({
      error: "Name and email are required",
    });
    return;
  }

  try {
    const planResult = await pool.query(
      `SELECT id FROM plans
       WHERE is_predefined = TRUE
         AND plan_type = 'user'
         AND name = 'Basic'`,
    );

    if (planResult.rows.length === 0) {
      res.status(500).json({ error: "Default user plan not found" });
      return;
    }

    const result = await pool.query(
      `INSERT INTO users (name, email, account_id, plan_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, account_id, plan_id, created_at`,
      [name.trim(), email.trim(), accountId, planResult.rows[0].id],
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(409).json({ error: "Email already exists" });
      return;
    }

    console.error("Failed to create user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List only users belonging to the authenticated account.
router.get("/", async (_req, res) => {
  try {
    const accountId = res.locals.account.id as number;

    const result = await pool.query(
      `SELECT id, name, email, account_id, plan_id, created_at
       FROM users
       WHERE account_id = $1
       ORDER BY id`,
      [accountId],
    );

    res.json({ users: result.rows });
  } catch (error) {
    console.error("Failed to fetch users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// Change a user's plan within the authenticated account.
router.patch("/:userId/plan", async (req, res) => {
  const userId = Number(req.params.userId);
  const planId = req.body?.planId;

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  if (!Number.isSafeInteger(planId) || planId <= 0) {
    res.status(400).json({ error: "A valid planId is required" });
    return;
  }

  try {
    const accountId = res.locals.account.id;

    const userResult = await pool.query(
      `SELECT id FROM users
       WHERE id = $1 AND account_id = $2`,
      [userId, accountId],
    );

    if (userResult.rows.length === 0) {
      res.status(404).json({ error: "User not found in this account" });
      return;
    }

    const planResult = await pool.query(
      `SELECT id FROM plans
       WHERE id = $1
         AND plan_type = 'user'
         AND (
           is_predefined = TRUE
           OR owner_account_id = $2
         )`,
      [planId, accountId],
    );

    if (planResult.rows.length === 0) {
      res.status(404).json({
        error: "User plan not found or not available to this account",
      });
      return;
    }

    const result = await pool.query(
      `UPDATE users
       SET plan_id = $1
       WHERE id = $2 AND account_id = $3
       RETURNING id, name, email, account_id, plan_id`,
      [planId, userId, accountId],
    );

    res.json({
      message: "User plan updated",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Failed to change user plan:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
export default router;
