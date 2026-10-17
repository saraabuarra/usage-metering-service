
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/index.js";
import { pool } from "../src/db.js";

describe("Usage and quota API", () => {
  let userId: number | undefined;

  afterAll(async () => {
    if (userId !== undefined) {
      await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    }

    await pool.end();
  });

  it("creates a user, enforces the quota, and prevents duplicate usage", async () => {
    const email = `test-${Date.now()}@example.com`;

    // Create a user
    const userResponse = await request(app)
      .post("/api/users")
      .send({ name: "Test User", email });

    expect(userResponse.status).toBe(201);
    userId = userResponse.body.user.id;

    // Create an active quota of 100 units
    const now = Date.now();
    const periodStart = new Date(now - 60_000).toISOString();
    const periodEnd = new Date(now + 86_400_000).toISOString();

    const quotaResponse = await request(app)
      .post("/api/quotas")
      .send({
        userId,
        quotaLimit: 100,
        periodStart,
        periodEnd,
      });

    expect(quotaResponse.status).toBe(201);
    expect(quotaResponse.body.quota.quota_limit).toBe("100");

    // Record 30 units
    const usageResponse = await request(app)
      .post("/api/usage")
      .send({
        userId,
        quantity: 30,
        idempotencyKey: `test-${Date.now()}-first`,
      });

    expect(usageResponse.status).toBe(201);
    expect(usageResponse.body.totalUsage).toBe("30");

    const idempotencyKey = `test-${Date.now()}-duplicate`;

    // Record 20 units using a key we'll reuse
    const firstRequest = await request(app)
      .post("/api/usage")
      .send({ userId, quantity: 20, idempotencyKey });

    expect(firstRequest.status).toBe(201);
    expect(firstRequest.body.totalUsage).toBe("50");

    // Repeating the same request must not add usage again
    const duplicateRequest = await request(app)
      .post("/api/usage")
      .send({ userId, quantity: 20, idempotencyKey });

    expect(duplicateRequest.status).toBe(200);
    expect(duplicateRequest.body.duplicate).toBe(true);

    // 50 used + 60 requested would exceed the quota
    const exceededResponse = await request(app)
      .post("/api/usage")
      .send({
        userId,
        quantity: 60,
        idempotencyKey: `test-${Date.now()}-exceeded`,
      });

    expect(exceededResponse.status).toBe(429);
    expect(exceededResponse.body.error).toBe("Quota exceeded");
    expect(exceededResponse.body.currentUsage).toBe("50");
    expect(exceededResponse.body.quotaLimit).toBe("100");
  });
});
