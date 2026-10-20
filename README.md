# Usage Metering and Quota Service

A TypeScript, Express, and PostgreSQL API for tracking usage against monthly account and user quotas.

The service supports API-key authentication, account isolation, configurable plans, request idempotency, monthly usage summaries, and request history.

## Features

- API-key authentication for account-specific operations.
- SHA-256 hashes for stored API keys; the raw key is returned only when an account is created.
- Account and user isolation.
- Predefined account plans: Starter and Pro.
- Predefined user plans: Basic and Premium.
- Custom account-owned plans with create, update, and delete operations.
- Monthly usage allowances and per-request maximums.
- Idempotent metering requests using a request ID.
- Accepted and rejected request history.
- UTC calendar-month usage summaries.
- PostgreSQL persistence.

## Requirements

- Node.js and npm
- Docker and Docker Compose
- PostgreSQL 17 (Docker Compose can run it)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
PORT=3000
DATABASE_URL=postgresql://app_user:local_dev_password@localhost:5433/usage_metering
```

Do not commit `.env` or share database credentials.

### 3. Start PostgreSQL

```bash
docker compose up -d db
```

Check that the database is healthy:

```bash
docker compose ps
```

### 4. Initialize the database

```bash
npm run migrate
```

This applies the SQL schema and account/plan migration, including the predefined plans.

### 5. Build and test

```bash
npm run build
npm test
```

### 6. Run the API

Development mode:

```bash
npm run dev
```

Production-style local run:

```bash
npm run build
npm start
```

The API listens on port `3000` by default. Set `PORT` to use a different port.

Check the health endpoint:

```bash
curl http://localhost:3000/health
```

## Authentication

Create an account:

```bash
curl -X POST http://localhost:3000/api/accounts \
  -H 'Content-Type: application/json' \
  -d '{"name":"Example Account"}'
```

The response includes an `apiKey`. Save it securely because it is not returned again.

Use the key in the `x-api-key` header for protected endpoints:

```bash
-H 'x-api-key: YOUR_API_KEY'
```

Missing or invalid keys are rejected. Each API key can access only its own account and users.

## API Endpoints

All JSON request bodies should use:

```http
Content-Type: application/json
```

### Health

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Check API and database health |

### Accounts

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/accounts` | Create an account and assign the Starter plan |
| GET | `/api/accounts/me` | Get the authenticated account and its plan |
| PATCH | `/api/accounts/me/plan` | Change the account's plan |

Change an account's plan:

```json
{
  "planId": 2
}
```

Use a plan ID returned by `GET /api/plans`.

### Users

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/users` | Create a user in the authenticated account |
| GET | `/api/users` | List users belonging to the authenticated account |
| PATCH | `/api/users/:userId/plan` | Change a user's plan |

Create a user:

```json
{
  "name": "Example User",
  "email": "user@example.com"
}
```

### Plans

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/plans` | List predefined plans and the account's custom plans |
| POST | `/api/plans` | Create a custom plan |
| PATCH | `/api/plans/:planId` | Update a custom plan owned by the account |
| DELETE | `/api/plans/:planId` | Delete an unused custom plan |

Create a custom user plan:

```json
{
  "planType": "user",
  "name": "Team User Plan",
  "monthlyAllowance": 8000,
  "maxUnitsPerRequest": 200
}
```

Create a custom account plan by setting `"planType": "account"`.

Predefined plans cannot be edited or deleted. Custom plans cannot be deleted while assigned to an account or user.

### Metering

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/usage` | Record a usage request |
| GET | `/api/usage/summary` | Get monthly account and per-user usage |
| GET | `/api/usage/:userId` | Get a user's request history |

Submit a metering request:

```json
{
  "userId": 1,
  "quantity": 10,
  "requestId": "request-001"
}
```

The quantity must be a positive integer. Each request must include a unique request ID within the account. The `idempotencyKey` field can be used instead of `requestId`.

Repeating the same request ID with the same user and quantity returns the previous decision without consuming usage again. Reusing that ID with different request data returns a conflict.

- Accepted requests return HTTP `201`.
- Quota rejections return HTTP `429` with the rejection scope and reason.
- Invalid input returns HTTP `400`.

Get a monthly summary:

```bash
curl 'http://localhost:3000/api/usage/summary?month=2026-10' \
  -H 'x-api-key: YOUR_API_KEY'
```

The `month` query parameter is optional and uses `YYYY-MM`. If omitted, the current UTC month is used.

The summary includes the account and its users, their plans, accepted usage, and remaining allowance. Remaining allowance is calculated using the current plan; historical plan changes are not tracked.

Get request history with pagination:

```bash
curl 'http://localhost:3000/api/usage/1?limit=50&offset=0' \
  -H 'x-api-key: YOUR_API_KEY'
```

The history includes accepted and rejected requests. The limit defaults to `50` and is capped at `100`.

### Legacy Quota Endpoints

The previous `/api/quotas` endpoints return HTTP `410 Gone`. Use plans and usage endpoints instead.

## Usage Rules

- Account allowances are shared across all users belonging to that account.
- Each user also has an independent monthly allowance.
- Both account and user limits must permit a request for it to be accepted.
- Per-request maximums are checked separately from monthly allowances.
- Only accepted requests contribute to usage totals.
- Rejected requests are recorded for audit/history but do not consume quota.
- Usage is calculated by UTC calendar month.
- A plan change affects future requests; previously recorded usage is preserved.
- If a plan's allowance is reduced below current usage, remaining allowance is zero and further requests that exceed the limit are rejected.

## Database and Migrations

The PostgreSQL service uses the named Docker volume `postgres_data` for persistence.

Stop the database without deleting its stored data:

```bash
docker compose stop db
```

Restart it:

```bash
docker compose up -d db
```

Do not use `docker compose down -v` unless you intentionally want to delete the database volume.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Run the API in development mode |
| `npm run build` | Compile the TypeScript application |
| `npm start` | Run the compiled application |
| `npm test` | Run automated tests |
| `npm run migrate` | Initialize/update the database schema and plans |

## Current Limitations

- There is no billing, refunds, or multiple resource-type support.
- Historical plan assignments are not recorded, so past summaries use the current plan's allowance for the remaining calculation.
- Authentication uses API keys rather than a user login/session system.
- Load-test performance depends on the environment and should not be treated as a production capacity guarantee.

## Load Testing

Start the API and database:

```bash
docker compose up -d --build
```

Run a small local test using the saved demo API key:

```bash
API_KEY="$(cat .demo-key)" USER_ID=YOUR_USER_ID REQUESTS=50 CONCURRENCY=5 node load-test/load-test.mjs
```

Replace `YOUR_USER_ID` with a user ID belonging to the demo account. The test sends real requests and creates usage-history records, so use a development database. Results depend on the local environment.

## Example Client

Run the example client against the local API:

```bash
node examples/client.mjs
```

The example creates an account and user, sends a metering request, retries it to demonstrate idempotency, tests user and account limits, and prints the usage summary.

The example creates test data in the configured database. Use a development database only.
