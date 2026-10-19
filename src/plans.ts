import { Router } from "express";
import { pool } from "./db.js";
import { requireApiKey } from "./auth.js";

const router = Router();

router.use(requireApiKey);

// List predefined plans and this account's custom plans.
router.get("/", async (_req, res) => {
  try {
    const accountId = res.locals.account.id;

    const result = await pool.query(
      `SELECT id, owner_account_id, plan_type, name,
              monthly_allowance, max_units_per_request,
              is_predefined, created_at, updated_at
       FROM plans
       WHERE is_predefined = TRUE OR owner_account_id = $1
       ORDER BY plan_type, is_predefined DESC, name`,
      [accountId],
    );

    res.json({ plans: result.rows });
  } catch (error) {
    console.error("Failed to list plans:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create a custom plan for the authenticated account.
router.post("/", async (req, res) => {
  const { planType, name, monthlyAllowance, maxUnitsPerRequest } =
    req.body ?? {};

  if (
    !["account", "user"].includes(planType) ||
    typeof name !== "string" ||
    !name.trim() ||
    !Number.isSafeInteger(monthlyAllowance) ||
    monthlyAllowance < 0 ||
    !Number.isSafeInteger(maxUnitsPerRequest) ||
    maxUnitsPerRequest <= 0
  ) {
    res.status(400).json({
      error:
        "Provide planType ('account' or 'user'), name, a non-negative integer monthlyAllowance, and a positive integer maxUnitsPerRequest",
    });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO plans
         (owner_account_id, plan_type, name, monthly_allowance,
          max_units_per_request, is_predefined)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING *`,
      [
        res.locals.account.id,
        planType,
        name.trim(),
        monthlyAllowance,
        maxUnitsPerRequest,
      ],
    );

    res.status(201).json({ plan: result.rows[0] });
  } catch (error: any) {
    if (error.code === "23505") {
      res.status(409).json({ error: "A plan with this name already exists" });
      return;
    }

    console.error("Failed to create plan:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update a custom plan owned by this account.
router.patch("/:planId", async (req, res) => {
  const planId = Number(req.params.planId);

  if (!Number.isSafeInteger(planId) || planId <= 0) {
    res.status(400).json({ error: "Invalid plan ID" });
    return;
  }

  const { name, monthlyAllowance, maxUnitsPerRequest } = req.body ?? {};

  if (
    (name !== undefined &&
      (typeof name !== "string" || !name.trim())) ||
    (monthlyAllowance !== undefined &&
      (!Number.isSafeInteger(monthlyAllowance) || monthlyAllowance < 0)) ||
    (maxUnitsPerRequest !== undefined &&
      (!Number.isSafeInteger(maxUnitsPerRequest) || maxUnitsPerRequest <= 0))
  ) {
    res.status(400).json({ error: "Invalid plan fields" });
    return;
  }

  if (
    name === undefined &&
    monthlyAllowance === undefined &&
    maxUnitsPerRequest === undefined
  ) {
    res.status(400).json({ error: "Provide at least one field to update" });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE plans
       SET name = COALESCE($1, name),
           monthly_allowance = COALESCE($2, monthly_allowance),
           max_units_per_request = COALESCE($3, max_units_per_request),
           updated_at = NOW()
       WHERE id = $4
         AND owner_account_id = $5
         AND is_predefined = FALSE
       RETURNING *`,
      [
        name === undefined ? null : name.trim(),
        monthlyAllowance ?? null,
        maxUnitsPerRequest ?? null,
        planId,
        res.locals.account.id,
      ],
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        error: "Custom plan not found or not owned by this account",
      });
      return;
    }

    res.json({ plan: result.rows[0] });
  } catch (error: any) {
    if (error.code === "23505") {
      res.status(409).json({ error: "A plan with this name already exists" });
      return;
    }

    console.error("Failed to update plan:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete an unused custom plan owned by this account.
router.delete("/:planId", async (req, res) => {
  const planId = Number(req.params.planId);

  if (!Number.isSafeInteger(planId) || planId <= 0) {
    res.status(400).json({ error: "Invalid plan ID" });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const planResult = await client.query(
      `SELECT id FROM plans
       WHERE id = $1
         AND owner_account_id = $2
         AND is_predefined = FALSE
       FOR UPDATE`,
      [planId, res.locals.account.id],
    );

    if (planResult.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({
        error: "Custom plan not found or not owned by this account",
      });
      return;
    }

    const assignedResult = await client.query(
      `SELECT 1
       FROM accounts
       WHERE account_plan_id = $1
       UNION ALL
       SELECT 1 FROM users WHERE plan_id = $1
       LIMIT 1`,
      [planId],
    );

    if (assignedResult.rows.length > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({
        error: "Cannot delete a plan that is currently assigned",
      });
      return;
    }

    await client.query("DELETE FROM plans WHERE id = $1", [planId]);
    await client.query("COMMIT");

    res.json({ message: "Plan deleted" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Failed to delete plan:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

export default router;
