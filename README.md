# Usage Metering and Quota Service

A TypeScript and PostgreSQL backend service for tracking application and user usage, enforcing configurable quotas, and recording consumption decisions.

## Overview

The service allows an application to check whether an action is permitted before performing it. Each account has a shared monthly allowance, and each user under that account has an individual allowance.

A request is accepted only when it satisfies both the account's and the user's applicable rules. Accepted requests update both usage totals. Rejected requests consume no units.

The service supports predefined plans and configurable custom plans, persistent usage history, API-key-based account isolation, and a small example client.

## Features

- Account and user management
- Account-specific API keys
- Account and user data isolation
- Predefined account and user plans
- Custom plan configuration
- Monthly usage allowances
- Maximum units per request
- Usage consumption decisions with rejection reasons
- Current and historical usage information
- Persistent PostgreSQL storage
- Automated tests
- Docker Compose setup
- Example client
- Load-testing script

## Technology Stack

- **Language:** TypeScript
- **Runtime:** Node.js
- **Backend:** Express
- **Database:** PostgreSQL
- **Testing:** Vitest
- **Containerization:** Docker and Docker Compose

## Architecture

The service separates the API layer, business logic, and database access.

- **API layer:** Receives requests and validates inputs.
- **Authentication:** Identifies the calling account through its API key.
- **Usage logic:** Evaluates account and user limits before accepting consumption.
- **Database:** Stores accounts, users, plans, assignments, usage records, and request history.
- **Example client:** Demonstrates consumption requests and quota decisions.

## Data Model

### Accounts

An account represents an application or company using the service. Each account has an API key, an assigned account plan, and its own users and shared usage totals.

### Users

Users belong to an account and have individual plans and usage totals. Users sharing a plan definition do not share their individual usage allowances.

### Plans

Plans define two rules:

- **Monthly allowance:** The maximum number of units available during a UTC calendar month.
- **Maximum units per request:** The largest amount permitted in one request.

Plans can be predefined or custom. Predefined plans are read-only, while custom plans can be configured through the service.

### Usage Records

Usage records preserve request outcomes and consumption history. Accepted requests update both the account's shared usage and the relevant user's usage.

## Quota Enforcement

Each consumption request is evaluated against both the account plan and the user plan.

1. Authenticate the account using its API key.
2. Validate the request and confirm that the user belongs to the account.
3. Check the account's maximum units per request.
4. Check the user's maximum units per request.
5. Check both monthly allowances.
6. Accept the complete request only if all applicable rules pass.
7. Record the outcome and update usage only for accepted requests.

If a request is rejected, the response identifies the rule that prevented consumption and whether it belongs to the account or user.

The account's usage represents the sum of accepted usage across its users. The same action is counted once at the account level and once at the relevant user level; these are two views of the same consumption, not two separate charges.

## Monthly Usage and Plan Changes

Usage is grouped by UTC calendar month. A new month starts with zero usage, while records from previous months remain available for historical queries.

Changing a plan affects new requests after the update succeeds. Switching plans does not reset previously consumed units.

If a monthly allowance is reduced below the amount already consumed, the remaining allowance is treated as zero, and further consumption is rejected at that level until the allowance permits it again.

Updating a custom plan affects the account or users assigned to that plan. Historical request outcomes remain preserved.

## Authentication and Account Isolation

Operations on an account and its users require the account's API key in the configured request header.

The service must reject missing or invalid API keys and verify that supplied user identifiers belong to the authenticated account. Requests must not expose or modify another account's data.

Keep API keys private. Do not commit `.env` files, credentials, or real API keys to version control.

## Local Setup

### Requirements

Install the following tools:

- Node.js
- npm
- Docker
- Docker Compose

### Configuration

Create a local `.env` file containing the environment variables required by the application. Use the repository's existing configuration and Compose files as the source of truth.

Do not commit `.env` to Git.

### Start the Service

From the project directory, run:

```bash
docker compose up --build
