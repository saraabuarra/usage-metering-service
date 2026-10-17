
import "dotenv/config";
import express from "express";
import { pool } from "./db.js";
import usersRouter from "./users.js";
import usageRouter from "./usage.js";
import quotasRouter from "./quotas.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

app.use("/api/users", usersRouter);
app.use("/api/usage", usageRouter);
app.use("/api/quotas", quotasRouter);

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Database connection failed:", error);
    res.status(500).json({ status: "error", database: "disconnected" });
  }
});

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;

