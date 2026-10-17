import { Router } from "express";
import { pool } from "./db.js";

const router = Router();

// Create a new user
router.post("/", async (req, res) => {
  const { name, email } = req.body;

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
    const result = await pool.query(
      `INSERT INTO users (name, email)
       VALUES ($1, $2)
       RETURNING id, name, email, created_at`,
      [name.trim(), email.trim()],
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

// Get all users
router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, created_at
       FROM users
       ORDER BY id`,
    );

    res.json({ users: result.rows });
  } catch (error) {
    console.error("Failed to fetch users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
