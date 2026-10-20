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
- PostgreSQL 17

## Setup

### 1. Install dependencies

```bash
npm install
