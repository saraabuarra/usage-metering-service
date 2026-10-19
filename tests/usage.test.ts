import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/index.js";
import { pool } from "../src/db.js";

describe("Accounts, authentication, and metering", () => {
  let accountAId: number | undefined;
  let accountBId: number | undefined;

  afterAll(async () => {
    if (accountAId !== undefined) {
      await pool.query("DELETE FROM accounts WHERE id = $1", [accountAId]);
    }

    if (accountBId !== undefined) {
      await pool.query("DELETE FROM accounts WHERE id = $1", [accountBId]);
    }

    await pool.end();
  });

  it("authenticates accounts, isolates users, and enforces request limits", async () => {
    // Create two separate accounts.
    const accountA = await request(app)
      .post("/api/accounts")
      .send({ name: `Test Account A ${Date.now()}` });

    expect(accountA.status).toBe(201);
    accountAId = accountA.body.account.id;
    const apiKeyA = accountA.body.apiKey;

    const accountB = await request(app)
      .post("/api/accounts")
      .send({ name: `Test Account B ${Date.now()}` });

    expect(accountB.status).toBe(201);
    accountBId = accountB.body.account.id;
    const apiKeyB = accountB.body.apiKey;

    // Missing and invalid API keys must be rejected.
    expect((await request(app).get("/api/users")).status).toBe(401);

    expect(
      (
        await request(app)
          .get("/api/users")
          .set("x-api-key", "invalid-api-key")
      ).status,
    ).toBe(401);

    // Create one user in each account.
    const userAResponse = await request(app)
      .post("/api/users")
      .set("x-api-key", apiKeyA)
      .send({
        name: "User A",
        email: `user-a-${Date.now()}@example.com`,
      });

    expect(userAResponse.status).toBe(201);
    const userAId = userAResponse.body.user.id;

    const userBResponse = await request(app)
      .post("/api/users")
      .set("x-api-key", apiKeyB)
      .send({
        name: "User B",
        email: `user-b-${Date.now()}@example.com`,
      });

    expect(userBResponse.status).toBe(201);

    // Each account can see only its own users.
    const usersA = await request(app)
      .get("/api/users")
      .set("x-api-key", apiKeyA);

    expect(usersA.status).toBe(200);
    expect(usersA.body.users.map((user: { id: number }) => user.id))
      .toContain(userAId);

    expect(
      usersA.body.users.some(
        (user: { id: number }) => user.id === userBResponse.body.user.id,
      ),
    ).toBe(false);

    // Account B cannot meter a user belonging to account A.
    const crossAccount = await request(app)
      .post("/api/usage")
      .set("x-api-key", apiKeyB)
      .send({
        userId: userAId,
        quantity: 1,
        requestId: `cross-${Date.now()}`,
      });

    expect(crossAccount.status).toBe(404);

    // A valid request is accepted.
    const requestId = `accepted-${Date.now()}`;

    const accepted = await request(app)
      .post("/api/usage")
      .set("x-api-key", apiKeyA)
      .send({
        userId: userAId,
        quantity: 10,
        requestId,
      });

    expect(accepted.status).toBe(201);
    expect(accepted.body.accepted).toBe(true);
    expect(accepted.body.userUsage).toBe("10");

    // Repeating the same request does not consume usage twice.
    const duplicate = await request(app)
      .post("/api/usage")
      .set("x-api-key", apiKeyA)
      .send({
        userId: userAId,
        quantity: 10,
        requestId,
      });

    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);

    // Basic plan permits at most 20 units per request.
    const userLimit = await request(app)
      .post("/api/usage")
      .set("x-api-key", apiKeyA)
      .send({
        userId: userAId,
        quantity: 21,
        requestId: `user-limit-${Date.now()}`,
      });

    expect(userLimit.status).toBe(429);
    expect(userLimit.body.accepted).toBe(false);
    expect(userLimit.body.rejectedBy).toBe("user");

    // Starter plan permits at most 100 units per request.
    const accountLimit = await request(app)
      .post("/api/usage")
      .set("x-api-key", apiKeyA)
      .send({
        userId: userAId,
        quantity: 101,
        requestId: `account-limit-${Date.now()}`,
      });

    expect(accountLimit.status).toBe(429);
    expect(accountLimit.body.accepted).toBe(false);
    expect(accountLimit.body.rejectedBy).toBe("account");

    // The monthly summary reports accepted usage and remaining allowance.
    const summary = await request(app)
      .get("/api/usage/summary")
      .set("x-api-key", apiKeyA);

    expect(summary.status).toBe(200);
    expect(summary.body.timezone).toBe("UTC");
    expect(summary.body.account.usage).toBe("10");
    expect(summary.body.account.remaining).toBe("9990");

    const summarizedUser = summary.body.users.find(
      (user: { user_id: number }) => user.user_id === userAId,
    );

    expect(summarizedUser).toBeDefined();
    expect(summarizedUser.usage).toBe("10");
    expect(summarizedUser.remaining).toBe("990");

    // Invalid month values are rejected.
    const invalidMonth = await request(app)
      .get("/api/usage/summary?month=2026-13")
      .set("x-api-key", apiKeyA);

    expect(invalidMonth.status).toBe(400);

    // Rejected requests are included in the history.
    const history = await request(app)
      .get(`/api/usage/${userAId}`)
      .set("x-api-key", apiKeyA);

    expect(history.status).toBe(200);
    expect(
      history.body.requests.some(
        (item: { request_id: string; accepted: boolean }) =>
          item.request_id.startsWith("user-limit-") &&
          item.accepted === false,
      ),
    ).toBe(true);
  });
});
