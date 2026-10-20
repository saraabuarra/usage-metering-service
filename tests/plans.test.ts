import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/index.js";
import { pool } from "../src/db.js";

describe("Custom plans and plan assignments", () => {
  const createdAccountIds: number[] = [];

  afterAll(async () => {
    for (const accountId of createdAccountIds) {
      await pool.query("DELETE FROM accounts WHERE id = $1", [accountId]);
    }

    await pool.end();
  });

  it("creates, updates, assigns, protects, and deletes custom plans", async () => {
    const suffix = `${Date.now()}`;

    const createAccount = async (name: string) => {
      const response = await request(app)
        .post("/api/accounts")
        .send({ name: `${name} ${suffix}` });

      expect(response.status).toBe(201);
      createdAccountIds.push(response.body.account.id);

      return {
        id: response.body.account.id as number,
        apiKey: response.body.apiKey as string,
      };
    };

    const accountA = await createAccount("Plans Test A");
    const accountB = await createAccount("Plans Test B");

    const createPlan = async (
      apiKey: string,
      planType: "account" | "user",
      name: string,
    ) =>
      request(app)
        .post("/api/plans")
        .set("x-api-key", apiKey)
        .send({
          planType,
          name: `${name} ${suffix}`,
          monthlyAllowance: 500,
          maxUnitsPerRequest: 50,
        });

    // Create a custom account plan.
    const accountPlan = await createPlan(
      accountA.apiKey,
      "account",
      "Custom Account",
    );

    expect(accountPlan.status).toBe(201);
    const accountPlanId = accountPlan.body.plan.id;

    // Create a custom user plan.
    const userPlan = await createPlan(
      accountA.apiKey,
      "user",
      "Custom User",
    );

    expect(userPlan.status).toBe(201);
    const userPlanId = userPlan.body.plan.id;

    // Reject invalid plans.
    const invalidPlan = await request(app)
      .post("/api/plans")
      .set("x-api-key", accountA.apiKey)
      .send({
        planType: "invalid",
        name: "Invalid",
        monthlyAllowance: -1,
        maxUnitsPerRequest: 0,
      });

    expect(invalidPlan.status).toBe(400);

    // List plans available to this account.
    const plans = await request(app)
      .get("/api/plans")
      .set("x-api-key", accountA.apiKey);

    expect(plans.status).toBe(200);
    expect(plans.body.plans.some(
      (plan: { id: number }) => plan.id === accountPlanId,
    )).toBe(true);

    // Update a custom plan.
    const updatedPlan = await request(app)
      .patch(`/api/plans/${userPlanId}`)
      .set("x-api-key", accountA.apiKey)
      .send({ monthlyAllowance: 700 });

    expect(updatedPlan.status).toBe(200);
    expect(Number(updatedPlan.body.plan.monthly_allowance)).toBe(700);

    // Another account cannot update this plan.
    const crossAccountUpdate = await request(app)
      .patch(`/api/plans/${userPlanId}`)
      .set("x-api-key", accountB.apiKey)
      .send({ name: `Changed ${suffix}` });

    expect(crossAccountUpdate.status).toBe(404);

    // Predefined plans cannot be updated.
    const predefinedPlans = plans.body.plans.filter(
      (plan: { is_predefined: boolean; plan_type: string }) =>
        plan.is_predefined && plan.plan_type === "user",
    );

    expect(predefinedPlans.length).toBeGreaterThan(0);

    const predefinedUpdate = await request(app)
      .patch(`/api/plans/${predefinedPlans[0].id}`)
      .set("x-api-key", accountA.apiKey)
      .send({ monthlyAllowance: 999 });

    expect(predefinedUpdate.status).toBe(404);

    // Assign the custom account plan.
    const assignAccountPlan = await request(app)
      .patch("/api/accounts/me/plan")
      .set("x-api-key", accountA.apiKey)
      .send({ planId: accountPlanId });

    expect(assignAccountPlan.status).toBe(200);
    expect(assignAccountPlan.body.account.account_plan_id).toBe(accountPlanId);

    // Create a user and assign the custom user plan.
    const createdUser = await request(app)
      .post("/api/users")
      .set("x-api-key", accountA.apiKey)
      .send({
        name: "Plans Test User",
        email: `plans-test-${suffix}@example.com`,
      });

    expect(createdUser.status).toBe(201);

    const userId = createdUser.body.user.id;

    const assignUserPlan = await request(app)
      .patch(`/api/users/${userId}/plan`)
      .set("x-api-key", accountA.apiKey)
      .send({ planId: userPlanId });

    expect(assignUserPlan.status).toBe(200);
    expect(assignUserPlan.body.user.plan_id).toBe(userPlanId);

    // Assigned plans cannot be deleted.
    const deleteAccountPlan = await request(app)
      .delete(`/api/plans/${accountPlanId}`)
      .set("x-api-key", accountA.apiKey);

    expect(deleteAccountPlan.status).toBe(409);

    const deleteUserPlan = await request(app)
      .delete(`/api/plans/${userPlanId}`)
      .set("x-api-key", accountA.apiKey);

    expect(deleteUserPlan.status).toBe(409);

    // Create and delete a separate unused plan.
    const unusedPlan = await createPlan(
      accountA.apiKey,
      "user",
      "Unused Plan",
    );

    expect(unusedPlan.status).toBe(201);

    const deleteUnusedPlan = await request(app)
      .delete(`/api/plans/${unusedPlan.body.plan.id}`)
      .set("x-api-key", accountA.apiKey);

    expect(deleteUnusedPlan.status).toBe(200);

    // Another account cannot delete the custom plan.
    const crossAccountDelete = await request(app)
      .delete(`/api/plans/${userPlanId}`)
      .set("x-api-key", accountB.apiKey);

    expect(crossAccountDelete.status).toBe(404);
  });
});
