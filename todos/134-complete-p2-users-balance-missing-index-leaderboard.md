---
name: users table missing index on balance for leaderboard query
description: ORDER BY balance DESC on users table has no supporting index — full table scan at 1000+ users
type: performance
status: pending
priority: p2
issue_id: "134"
tags: [code-review, performance, database, indexes]
dependencies: []
---

## Problem Statement

`GET /api/leaderboard` queries `SELECT ... FROM users ORDER BY balance DESC LIMIT 100`. The `users` table has no index on `balance`. At 1000+ users, Postgres does a full sequential scan + sort. The leaderboard page also uses the same pattern server-side.

## Findings

- **`src/app/api/leaderboard/route.ts:17`**: `ORDER BY balance DESC`
- **`src/db/schema.ts:16-29`**: no `balance` index defined

## Proposed Solutions

### Option A: Add balance index to schema
```ts
index("users_balance_idx").on(table.balance)
```
- **Effort:** Small (schema + migration)
- **Risk:** None

## Acceptance Criteria
- [ ] Index on `users.balance` exists
- [ ] Migration applied
- [ ] Leaderboard query uses index scan

## Work Log
- 2026-04-06: Identified by performance-oracle during ce:review
