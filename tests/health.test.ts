
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/index.js";
import { pool } from "../src/db.js";

describe("Health endpoint", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("returns the API and database health status", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      database: "connected",
    });
  });
});
