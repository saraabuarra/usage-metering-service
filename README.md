# Usage Metering and Quota Service

A TypeScript, Express, and PostgreSQL service that tracks usage and enforces monthly quotas for both an application account and its individual users.

## Overview

An account represents an application or company using the service. Each account has a shared monthly allowance, while every user under that account has a separate individual allowance. A consumption request is accepted only when it satisfies both the account's and the user's plan rules.

Accepted requests count toward both the account's shared usage and the relevant user's usage. Rejected requests consume no units. Request outcomes are stored in PostgreSQL and can be queried later.

## Features

- Create accounts and issue account-specific API keys.
- Register users under an account.
- Assign predefined or account-owned custom plans.
- Configure monthly allowances and maximum units per request.
- Accept or reject usage requests with a rejection scope and reason.
- Keep request history, including rejected requests.
- Prevent duplicate consumption when a request is retried with the same request ID and payload.
- View account and per-user usage summaries for a selected UTC month.
- Paginate user request history.
- Persist data in PostgreSQL.
- Run the API and example client using Docker Compose.
- Run automated tests and a configurable load-test script.

## Technology Stack

- TypeScript and Node.js
- Express
- PostgreSQL
- Vitest and Supertest
- Docker and Docker Compose

## Plans and Quota Rules

Every account has an account plan, and every user has a user plan. Each plan defines:

- **Monthly allowance:** total units available during a UTC calendar month.
- **Maximum units per request:** the largest number of units allowed in a single request.

The predefined plans are initialized by the database migration:

| Plan type | Plan | Monthly allowance | Maximum per request |
|---|---|---:|---:|
| Account | Starter | 10,000 | 100 |
| Account | Pro | 100,000 | 1,000 |
| User | Basic | 1,000 | 20 |
| User | Premium | 5,000 | 100 |

New accounts receive the **Starter** account plan. New users receive the **Basic** user plan.

Custom plans belong to the account that created them. An account can list predefined plans and its own custom plans, create and update custom plans, and assign them to the account or its users. Predefined plans cannot be updated or deleted. A custom plan cannot be deleted while it is assigned.

## How Consumption Works

For each request, the service:

1. Authenticates the account using the `x-api-key` request header.
2. Validates the user ID, positive integer quantity, and request ID.
3. Confirms the user belongs to the authenticated account.
4. Checks the account's maximum-per-request and monthly limits.
5. Checks the user's maximum-per-request and monthly limits.
6. Stores the decision. Only accepted requests contribute to usage totals.

If a request is rejected, the response identifies the limiting scope (`account` or `user`) and includes a reason. The service accepts or rejects the full request; it does not partially consume units.

The account's usage is shared across all users belonging to it. Users sharing the same plan definition still have separate personal usage totals.

### Retries and Request IDs

Each consumption request must include a `requestId`. A repeated request ID for the same account and same user/quantity returns the existing outcome rather than counting the request twice. Reusing the same ID with different request data returns HTTP 409 Conflict.

### Monthly Usage and Plan Changes

Usage is grouped by UTC calendar month. A new month starts with zero usage, and previous request records remain available for history queries.

Changing an account or user plan affects subsequent requests; it does not reset units already consumed. If an allowance is reduced below existing usage, the remaining allowance is reported as zero and further consumption at that level is rejected until the allowance permits it again.

## Authentication and Account Isolation

The account API key is sent using the `x-api-key` header. The service stores a SHA-256 hash of each API key rather than the raw key. The raw key is returned only when an account is created, so save it securely.

Requests to protected account, user, plan, and usage endpoints reject missing or invalid keys. User and custom-plan operations are scoped to the authenticated account to prevent cross-account access.

Do not commit real API keys, passwords, or local `.env` files to version control.

## API Reference

All request and response bodies use JSON.

| Method | Endpoint | Purpose | Authentication |
|---|---|---|---|
| `GET` | `/health` | Check API and database health | No |
| `POST` | `/api/accounts` | Create an account and receive its API key | No |
| `GET` | `/api/accounts/me` | Get the authenticated account and current plan details | Yes |
| `PATCH` | `/api/accounts/me/plan` | Change the authenticated account's plan | Yes |
| `GET` | `/api/users` | List users belonging to the account | Yes |
| `POST` | `/api/users` | Create a user under the account | Yes |
| `PATCH` | `/api/users/:userId/plan` | Change a user's plan | Yes |
| `GET` | `/api/plans` | List predefined and account-owned custom plans | Yes |
| `POST` | `/api/plans` | Create a custom account or user plan | Yes |
| `PATCH` | `/api/plans/:planId` | Update an account-owned custom plan | Yes |
| `DELETE` | `/api/plans/:planId` | Delete an unused custom plan | Yes |
| `POST` | `/api/usage` | Submit a consumption request | Yes |
| `GET` | `/api/usage/summary` | Get account and user usage for a month | Yes |
| `GET` | `/api/usage/:userId` | Get paginated request history for a user | Yes |

Protected requests use:

```http
x-api-key: YOUR_ACCOUNT_API_KEY
Content-Type: application/json
