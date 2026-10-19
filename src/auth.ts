import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { pool } from "./db.js";

export async function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const apiKey = req.header("x-api-key");

  if (!apiKey) {
    res.status(401).json({ error: "Missing API key" });
    return;
  }

  const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");

  try {
    const result = await pool.query(
      `SELECT id, name, account_plan_id
       FROM accounts
       WHERE api_key_hash = $1`,
      [apiKeyHash],
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    res.locals.account = result.rows[0];
    next();
  } catch (error) {
    console.error("API key validation failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
