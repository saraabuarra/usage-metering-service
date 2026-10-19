import { Router } from "express";
import { pool } from "./db.js";
import { requireApiKey } from "./auth.js";

const router = Router();

router.use(requireApiKey);

router.post("/", async (req, res) => {
  const { userId, quantity } = req.body ?? {};
  const requestId = req.body?.requestId ?? req.body?.idempotencyKey;
  const accountId = res.locals.account.id as number;

  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    typeof requestId !== "string" ||
    !requestId.trim() ||
    requestId.trim().length > 255
  ) {
    res.status(400).json({
      error: "A valid userId, positive quantity, and requestId are required",
    });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Serialize consumption for this account.
    const accountResult = await client.query(
      `SELECT a.id, a.account_plan_id,
              p.monthly_allowance, p.max_units_per_request
       FROM accounts a
       JOIN plans p ON p.id = a.account_plan_id
       WHERE a.id = $1
       FOR UPDATE OF a`,
      [accountId],
    );

    if (accountResult.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Account plan is not configured" });
      return;
    }

    // Check request idempotency within this account.
    const existingResult = await client.query(
      `SELECT id, user_id, quantity, accepted,
              rejection_scope, rejection_reason, processed_at
       FROM metering_requests
       WHERE account_id = $1 AND request_id = $2`,
      [accountId, requestId.trim()],
    );

    if (existingResult.rowCount) {
      const existing = existingResult.rows[0];

      if (existing.user_id !== userId || Number(existing.quantity) !== quantity) {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: "Request ID already used with different request data",
        });
        return;
      }

      await client.query("COMMIT");
      res.status(existing.accepted ? 200 : 429).json({
        ...existing,
        duplicate: true,
      });
      return;
    }

    const userResult = await client.query(
      `SELECT u.id, u.plan_id,
              p.monthly_allowance, p.max_units_per_request
       FROM users u
       JOIN plans p ON p.id = u.plan_id
       WHERE u.id = $1 AND u.account_id = $2
       FOR UPDATE OF u`,
      [userId, accountId],
    );

    if (userResult.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "User not found in this account" });
      return;
    }

    const account = accountResult.rows[0];
    const user = userResult.rows[0];

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const nextMonth = new Date(monthStart);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);

    const usageResult = await client.query(
      `SELECT
         COALESCE(SUM(quantity), 0)::text AS account_usage,
         COALESCE(SUM(quantity) FILTER (WHERE user_id = $2), 0)::text AS user_usage
       FROM metering_requests
       WHERE account_id = $1
         AND accepted = TRUE
         AND processed_at >= $3
         AND processed_at < $4`,
      [accountId, userId, monthStart.toISOString(), nextMonth.toISOString()],
    );

    const currentAccountUsage = BigInt(usageResult.rows[0].account_usage);
    const currentUserUsage = BigInt(usageResult.rows[0].user_usage);
    const amount = BigInt(quantity);

    const accountAllowance = BigInt(account.monthly_allowance);
    const userAllowance = BigInt(user.monthly_allowance);
    const accountMaxRequest = BigInt(account.max_units_per_request);
    const userMaxRequest = BigInt(user.max_units_per_request);

    let rejectionScope: "account" | "user" | null = null;
    let rejectionReason: string | null = null;

    if (
      amount > accountMaxRequest ||
      currentAccountUsage + amount > accountAllowance
    ) {
      rejectionScope = "account";
      rejectionReason =
        amount > accountMaxRequest
          ? "Request exceeds account maximum units per request"
          : "Account monthly allowance exceeded";
    } else if (
      amount > userMaxRequest ||
      currentUserUsage + amount > userAllowance
    ) {
      rejectionScope = "user";
      rejectionReason =
        amount > userMaxRequest
          ? "Request exceeds user maximum units per request"
          : "User monthly allowance exceeded";
    }

    const accepted = rejectionScope === null;

    const insertResult = await client.query(
      `INSERT INTO metering_requests
         (account_id, user_id, request_id, quantity, accepted,
          rejection_scope, rejection_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, account_id, user_id, request_id, quantity,
                 accepted, rejection_scope, rejection_reason, processed_at`,
      [
        accountId,
        userId,
        requestId.trim(),
        quantity,
        accepted,
        rejectionScope,
        rejectionReason,
      ],
    );

    await client.query("COMMIT");

    if (!accepted) {
      res.status(429).json({
        ...insertResult.rows[0],
        error: rejectionReason,
        rejectedBy: rejectionScope,
        accountUsage: currentAccountUsage.toString(),
        userUsage: currentUserUsage.toString(),
        accountRemaining: (
          accountAllowance > currentAccountUsage
            ? accountAllowance - currentAccountUsage
            : 0n
        ).toString(),
        userRemaining: (
          userAllowance > currentUserUsage
            ? userAllowance - currentUserUsage
            : 0n
        ).toString(),
      });
      return;
    }

    res.status(201).json({
      ...insertResult.rows[0],
      accountUsage: (currentAccountUsage + amount).toString(),
      userUsage: (currentUserUsage + amount).toString(),
      accountRemaining: (
        accountAllowance - currentAccountUsage - amount
      ).toString(),
      userRemaining: (
        userAllowance - currentUserUsage - amount
      ).toString(),
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Failed to process metering request:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});


// Summarize account and per-user usage for a UTC calendar month.
router.get("/summary", async (req, res) => {
  const accountId = res.locals.account.id as number;
  const month = req.query.month === undefined
    ? new Date().toISOString().slice(0, 7)
    : String(req.query.month);

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    res.status(400).json({
      error: "Invalid month. Use YYYY-MM, for example 2026-10",
    });
    return;
  }

  const monthStart = new Date(`${month}-01T00:00:00.000Z`);
  const nextMonth = new Date(monthStart);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);

  try {
    const accountResult = await pool.query(
      `SELECT
         a.id AS account_id,
         a.name AS account_name,
         ap.name AS plan_name,
         ap.monthly_allowance::text AS monthly_allowance,
         ap.max_units_per_request::text AS max_units_per_request,
         COALESCE(SUM(m.quantity) FILTER (WHERE m.accepted = TRUE), 0)::text
           AS usage
       FROM accounts a
       JOIN plans ap ON ap.id = a.account_plan_id
       LEFT JOIN metering_requests m
         ON m.account_id = a.id
        AND m.processed_at >= $2
        AND m.processed_at < $3
       WHERE a.id = $1
       GROUP BY a.id, a.name, ap.id`,
      [accountId, monthStart.toISOString(), nextMonth.toISOString()],
    );

    if (accountResult.rowCount === 0) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    const usersResult = await pool.query(
      `SELECT
         u.id AS user_id,
         u.name,
         u.email,
         p.name AS plan_name,
         p.monthly_allowance::text AS monthly_allowance,
         p.max_units_per_request::text AS max_units_per_request,
         COALESCE(SUM(m.quantity) FILTER (WHERE m.accepted = TRUE), 0)::text
           AS usage
       FROM users u
       JOIN plans p ON p.id = u.plan_id
       LEFT JOIN metering_requests m
         ON m.account_id = u.account_id
        AND m.user_id = u.id
        AND m.processed_at >= $2
        AND m.processed_at < $3
       WHERE u.account_id = $1
       GROUP BY u.id, u.name, u.email, p.id
       ORDER BY u.id`,
      [accountId, monthStart.toISOString(), nextMonth.toISOString()],
    );

    const account = accountResult.rows[0];
    const accountUsage = BigInt(account.usage);
    const accountAllowance = BigInt(account.monthly_allowance);

    const users = usersResult.rows.map((user) => {
      const usage = BigInt(user.usage);
      const allowance = BigInt(user.monthly_allowance);

      return {
        ...user,
        remaining: (allowance > usage ? allowance - usage : 0n).toString(),
      };
    });

    res.json({
      month,
      timezone: "UTC",
      account: {
        ...account,
        remaining: (
          accountAllowance > accountUsage
            ? accountAllowance - accountUsage
            : 0n
        ).toString(),
      },
      users,
    });
  } catch (error) {
    console.error("Failed to fetch usage summary:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Show request history for a user in the authenticated account.
router.get("/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  const accountId = res.locals.account.id as number;

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const limit = Math.min(
    Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
    100,
  );
  const offset = Math.max(
    Number.parseInt(String(req.query.offset ?? "0"), 10) || 0,
    0,
  );

  try {
    const result = await pool.query(
      `SELECT id, user_id, request_id, quantity, accepted,
              rejection_scope, rejection_reason, processed_at
       FROM metering_requests
       WHERE account_id = $1 AND user_id = $2
       ORDER BY processed_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [accountId, userId, limit, offset],
    );

    res.json({ requests: result.rows, limit, offset });
  } catch (error) {
    console.error("Failed to fetch request history:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
