# Usage Metering API — Load Test Results

## Test Configuration

- Total requests: 10
- Concurrency: 2
- Base URL: `http://localhost:3000`
- Test script: `load-test/load-test.mjs`

## Results

- Elapsed time: 0.32 seconds
- Throughput: 31.68 requests/second
- HTTP 2xx: 10
- HTTP 4xx: 0
- HTTP 5xx: 0
- Network errors: 0
- p50 latency: 22.75 ms
- p95 latency: 209.28 ms

## Reproduce

Run the following command from the project root:

```bash
API_KEY="$(cat .demo-key)" USER_ID=29 REQUESTS=10 CONCURRENCY=2 node load-test/load-test.mjs
```

## Notes

This was a small load test using 10 requests with a concurrency level of 2.

All 10 requests succeeded in this run, with no HTTP errors or network errors.

This test provides a basic check of API performance and is not a comprehensive stress test. Results may vary between runs.