import { performance } from "node:perf_hooks";

const baseUrl = process.env.BASE_URL || "http://localhost:3000";
const apiKey = process.env.API_KEY;

if (!apiKey) {
  console.error("Set API_KEY before running the load test.");
  process.exit(1);
}

const totalRequests = Number(process.env.REQUESTS || 50);
const concurrency = Number(process.env.CONCURRENCY || 5);
const userId = Number(process.env.USER_ID);

if (!Number.isInteger(userId) || userId <= 0) {
  console.error("Set USER_ID to an existing user ID.");
  process.exit(1);
}

let nextRequest = 0;
const results = [];

async function worker() {
  while (true) {
    const index = nextRequest++;
    if (index >= totalRequests) return;

    const started = performance.now();

    try {
      const response = await fetch(`${baseUrl}/api/usage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          userId,
          quantity: 1,
          requestId: `load-test-${Date.now()}-${index}`,
        }),
      });

      await response.text();

      results.push({
        status: response.status,
        duration: performance.now() - started,
      });
    } catch (error) {
      results.push({
        status: "ERROR",
        duration: performance.now() - started,
      });
    }
  }
}

const started = performance.now();

await Promise.all(
  Array.from(
    { length: Math.min(concurrency, totalRequests) },
    () => worker(),
  ),
);

const elapsed = performance.now() - started;
const durations = results.map((r) => r.duration).sort((a, b) => a - b);
const percentile = (p) =>
  durations[Math.min(durations.length - 1, Math.ceil(p * durations.length) - 1)];

console.log("\nUsage Metering API Load Test");
console.log("----------------------------");
console.log(`Total requests: ${totalRequests}`);
console.log(`Concurrency: ${concurrency}`);
console.log(`Elapsed: ${(elapsed / 1000).toFixed(2)} seconds`);
console.log(`Throughput: ${(results.length / (elapsed / 1000)).toFixed(2)} requests/sec`);
console.log(`HTTP 2xx: ${results.filter((r) => typeof r.status === "number" && r.status >= 200 && r.status < 300).length}`);
console.log(`HTTP 4xx: ${results.filter((r) => typeof r.status === "number" && r.status >= 400 && r.status < 500).length}`);
console.log(`HTTP 5xx: ${results.filter((r) => typeof r.status === "number" && r.status >= 500).length}`);
console.log(`Network errors: ${results.filter((r) => r.status === "ERROR").length}`);
console.log(`p50 latency: ${percentile(0.50).toFixed(2)} ms`);
console.log(`p95 latency: ${percentile(0.95).toFixed(2)} ms`);
