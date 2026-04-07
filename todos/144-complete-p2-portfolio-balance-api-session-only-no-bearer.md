---
name: /api/portfolio and /api/balance require session auth — agents cannot access them
description: Both endpoints use auth() (cookie session) with no bearer token alternative, blocking agent access to portfolio state
type: feature
status: pending
priority: p2
issue_id: "144"
tags: [code-review, agent-native, api, authentication]
dependencies: [127]
---

## Problem Statement

`GET /api/portfolio` and `GET /api/balance` both call `auth()` for session-based authentication. An agent calling with `Authorization: Bearer <CRON_SECRET>` gets a 401. Neither endpoint is documented in AGENTS.md. Agents cannot check their balance or positions.

## Findings

- **`src/app/api/portfolio/route.ts:9-13`**: `auth()` only
- **`src/app/api/balance/route.ts:8-12`**: `auth()` only
- Agent-native-reviewer capability map shows both as "P2 — bearer not accepted"

## Proposed Solutions

### Option A: Accept bearer token as alternative auth path
```ts
const authHeader = request.headers.get("authorization");
if (authHeader?.startsWith("Bearer ")) {
  const valid = verifyCronAuth(authHeader.replace("Bearer ", ""), request);
  // For bearer: use a specific agent user ID from env, or skip user-specific data
}
```
Note: portfolio is user-specific — bearer token agents would need a designated agent user account.
- **Effort:** Medium

### Option B: Document the limitation in AGENTS.md
Accept that portfolio/balance are session-only for now, but document it clearly.
- **Effort:** Tiny

## Acceptance Criteria
- [ ] Either bearer token auth is accepted by both endpoints, OR
- [ ] AGENTS.md clearly documents that these endpoints require a session cookie and explains the intended agent pattern
- [ ] If bearer supported: portfolio returns data for a configured agent user

## Work Log
- 2026-04-06: Identified by agent-native-reviewer during ce:review
