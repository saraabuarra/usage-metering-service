import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const directory = fileURLToPath(new URL("../sql/", import.meta.url));

async function migrate() {
  try {
    const schema = await readFile(`${directory}schema.sql`, "utf8");
    const accountsPlans = await readFile(
      `${directory}002_accounts_plans.sql`,
      "utf8",
    );

    await pool.query(schema);
    await pool.query(accountsPlans);

    console.log("Database schema and plans initialized successfully.");
  } catch (error) {
    console.error("Database initialization failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await migrate();
