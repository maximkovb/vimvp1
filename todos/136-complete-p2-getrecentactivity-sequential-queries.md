---
name: getRecentActivity runs 2 sequential DB queries that could be parallel
description: User fetch and coinTransactions fetch are awaited sequentially in getRecentActivity — adds unnecessary latency to balance flyout
type: performance
status: pending
priority: p2
issue_id: "136"
tags: [code-review, performance, database]
dependencies: []
---

## Problem Statement

`src/lib/actions/economy.ts:126-151` awaits two independent DB queries sequentially:
1. `SELECT loginStreak, lastLoginReward FROM users WHERE id = ?`
2. `SELECT ... FROM coinTransactions LEFT JOIN markets ...`

Both queries are independent. Sequential execution adds the latency of query 1 before query 2 starts — visible as a slow balance flyout open.

## Findings

- **`src/lib/actions/economy.ts:130`**: sequential `await` on independent queries

## Proposed Solutions

### Option A: Use Promise.all
```ts
const [userResult, recentTransactions] = await Promise.all([
  db.select({ loginStreak: users.loginStreak, lastLoginReward: users.lastLoginReward })
    .from(users).where(eq(users.id, userId)).limit(1),
  db.select(...).from(coinTransactions).leftJoin(markets, ...).where(...).limit(5),
]);
```
- **Effort:** Tiny
- **Risk:** None — queries are fully independent

## Acceptance Criteria
- [ ] Both queries run in parallel
- [ ] Balance flyout open latency reduced by ~50% (one RTT saved)

## Work Log
- 2026-04-06: Identified by performance-oracle during ce:review
