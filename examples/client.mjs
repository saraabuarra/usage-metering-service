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

  const data = await response.json();

  if (!response.ok && data.accepted !== false) {
    throw new Error(`${method} ${path}: ${JSON.stringify(data)}`);
  }

  return { status: response.status, data };
}

async function main() {
  const accountResult = await call("/api/accounts", {
    method: "POST",
    body: { name: `Example Client ${Date.now()}` },
  });

  const { account, apiKey } = accountResult.data;
  if (!apiKey) throw new Error("Account creation did not return an API key.");

  console.log("1. Account created:", account.name);

  const userResult = await call("/api/users", {
    method: "POST",
    apiKey,
    body: {
      name: "Example User",
      email: `example-${Date.now()}@example.com`,
    },
  });

  const userId = userResult.data.user.id;
  console.log("2. User created:", userId);

  const first = await call("/api/usage", {
    method: "POST",
    apiKey,
    body: { userId, quantity: 10, requestId: "example-request-1" },
  });
  console.log("3. Request for 10 units:", first.data.accepted ? "ACCEPTED" : "REJECTED");

  const duplicate = await call("/api/usage", {
    method: "POST",
    apiKey,
    body: { userId, quantity: 10, requestId: "example-request-1" },
  });
  console.log("4. Retry same request:", duplicate.data.duplicate ? "DUPLICATE (not counted again)" : JSON.stringify(duplicate.data));

  const userLimit = await call("/api/usage", {
    method: "POST",
    apiKey,
    body: { userId, quantity: 21, requestId: "example-request-2" },
  });
  console.log("5. Request for 21 units:", userLimit.data.accepted ? "ACCEPTED" : `REJECTED (${userLimit.data.rejectedBy || userLimit.data.rejection_scope || "limit"})`);

  const planResult = await call("/api/plans", {
    method: "POST",
    apiKey,
    body: {
      planType: "account",
      name: `Example Limit ${Date.now()}`,
      monthlyAllowance: 15,
      maxUnitsPerRequest: 100,
    },
  });

  await call("/api/accounts/me/plan", {
    method: "PATCH",
    apiKey,
    body: { planId: planResult.data.plan.id },
  });
  console.log("6. Account plan changed to a 15-unit monthly allowance.");

  const accountLimit = await call("/api/usage", {
    method: "POST",
    apiKey,
    body: { userId, quantity: 6, requestId: "example-request-3" },
  });
  console.log("7. Request for 6 more units:", accountLimit.data.accepted ? "ACCEPTED" : `REJECTED (${accountLimit.data.rejectedBy || accountLimit.data.rejection_scope || "limit"})`);

  const summary = await call("/api/usage/summary", { apiKey });
  console.log("8. Final usage summary:");
  console.log(JSON.stringify(summary.data, null, 2));
}

main().catch((error) => {
  console.error("Example client failed:", error.message);
  process.exitCode = 1;
});
