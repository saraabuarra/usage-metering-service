const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function call(path, { method = "GET", apiKey, body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();

let data;
try {
  data = JSON.parse(text);
} catch {
  throw new Error(
    `${method} ${path} returned non-JSON (HTTP ${response.status}): ${text.slice(0, 200)}`,
  );
}

  if (!response.ok && data.accepted !== false && !data.rejectedBy) {
    throw new Error(`${method} ${path}: ${JSON.stringify(data)}`);
  }

  return { status: response.status, data };
}

async function main() {
  const suffix = `${Date.now()}`;

  // Create an account and receive its API key.
  const accountResult = await call("/api/accounts", {
    method: "POST",
    body: { name: `Example Client ${suffix}` },
  });

  const { account, apiKey } = accountResult.data;
  if (!apiKey) throw new Error("Account creation did not return an API key.");

  console.log("1. Account created:", account.name);

  // Create two users under the same account.
  const userAResult = await call("/api/users", {
    method: "POST",
    apiKey,
    body: {
      name: "Basic User",
      email: `basic-${suffix}@example.com`,
    },
  });

  const userBResult = await call("/api/users", {
    method: "POST",
    apiKey,
    body: {
      name: "Premium User",
      email: `premium-${suffix}@example.com`,
    },
  });

  const userA = userAResult.data.user.id;
  const userB = userBResult.data.user.id;

  console.log(`2. Created two users under one account: ${userA}, ${userB}`);

  // Create a custom user plan with a small request limit.
  const userPlanResult = await call("/api/plans", {
    method: "POST",
    apiKey,
    body: {
      planType: "user",
      name: `Example User Plan ${suffix}`,
      monthlyAllowance: 100,
      maxUnitsPerRequest: 20,
    },
  });

  const userPlanId = userPlanResult.data.plan.id;

  // Give the second user a different plan.
  const premiumPlanResult = await call("/api/plans", {
    method: "POST",
    apiKey,
    body: {
      planType: "user",
      name: `Example Premium Plan ${suffix}`,
      monthlyAllowance: 500,
      maxUnitsPerRequest: 50,
    },
  });

  const premiumPlanId = premiumPlanResult.data.plan.id;

  await call(`/api/users/${userA}/plan`, {
    method: "PATCH",
    apiKey,
    body: { planId: userPlanId },
  });

  await call(`/api/users/${userB}/plan`, {
    method: "PATCH",
    apiKey,
    body: { planId: premiumPlanId },
  });

  console.log("3. Assigned different plans to the two users.");

  // Accept a request for the first user.
  const first = await call("/api/usage", {
    method: "POST",
    apiKey,
    body: { userId: userA, quantity: 10, requestId: `request-1-${suffix}` },
  });

  console.log("4. Request for 10 units:", first.data.accepted ? "ACCEPTED" : "REJECTED");

  // Retry the exact same request; it must not be counted twice.
  const duplicate = await call("/api/usage", {
    method: "POST",
    apiKey,
    body: { userId: userA, quantity: 10, requestId: `request-1-${suffix}` },
  });

  console.log(
    "5. Retry same request:",
    duplicate.data.duplicate ? "DUPLICATE (not counted again)" : JSON.stringify(duplicate.data),
  );

  // Exceed the first user's maximum of 20 units per request.
  const userLimit = await call("/api/usage", {
    method: "POST",
    apiKey,
    body: { userId: userA, quantity: 21, requestId: `request-2-${suffix}` },
  });

  console.log(
    "6. Request for 21 units:",
    userLimit.data.accepted ? "ACCEPTED" : `REJECTED (${userLimit.data.rejectedBy})`,
  );

  // Change the account to a 15-unit allowance. User A has already used 10.
  const accountPlanResult = await call("/api/plans", {
    method: "POST",
    apiKey,
    body: {
      planType: "account",
      name: `Example Account Limit ${suffix}`,
      monthlyAllowance: 15,
      maxUnitsPerRequest: 100,
    },
  });

  await call("/api/accounts/me/plan", {
    method: "PATCH",
    apiKey,
    body: { planId: accountPlanResult.data.plan.id },
  });

  console.log("7. Account plan changed to a 15-unit monthly allowance.");

  // This request is within the user's request limit but exceeds account allowance.
  const accountLimit = await call("/api/usage", {
    method: "POST",
    apiKey,
    body: { userId: userA, quantity: 6, requestId: `request-3-${suffix}` },
  });

  console.log(
    "8. Request for 6 more units:",
    accountLimit.data.accepted ? "ACCEPTED" : `REJECTED (${accountLimit.data.rejectedBy})`,
  );

  // Change User A's plan; the same API call now uses the new plan.
  const updatedUserPlan = await call(`/api/plans/${userPlanId}`, {
    method: "PATCH",
    apiKey,
    body: {
      planId: userPlanId,
      monthlyAllowance: 200,
      maxUnitsPerRequest: 30,
    },
  });

  console.log(
    "9. Updated User A's plan limits:",
    updatedUserPlan.data.plan.monthly_allowance,
    "monthly units; max request",
    updatedUserPlan.data.plan.max_units_per_request,
  );

  // A small request should now pass the user limit (the account has 5 left).
  const afterPlanChange = await call("/api/usage", {
    method: "POST",
    apiKey,
    body: { userId: userA, quantity: 5, requestId: `request-4-${suffix}` },
  });

  console.log(
    "10. Request after user plan change:",
    afterPlanChange.data.accepted ? "ACCEPTED" : `REJECTED (${afterPlanChange.data.rejectedBy})`,
  );

  const summary = await call("/api/usage/summary", { apiKey });
  console.log("11. Final usage summary:");
  console.log(JSON.stringify(summary.data, null, 2));
}

main().catch((error) => {
  console.error("Example client failed:", error.message);
  process.exitCode = 1;
});
