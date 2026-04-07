---
name: resolveNow admin action has TOCTOU race on status transition
description: resolveNow reads market status then updates it separately — concurrent cron run can cause double payout execution
type: bug
status: pending
priority: p1
issue_id: "125"
tags: [code-review, architecture, race-condition, payout]
dependencies: []
---

## Problem Statement

`resolveNow()` in `src/lib/actions/admin.ts:434-468` reads market status, then in a separate statement transitions to `"resolving"`, then calls `resolveMarket()`. If the `resolve-markets` cron runs concurrently and already moved the market to `"resolving"`, both paths will call `resolveMarket()` simultaneously. The `distributePayout` idempotency check prevents double payment, but two concurrent transactions executing payout logic is brittle and wastes the single Neon connection.

**Why:** Status check and state transition are not atomic.

## Findings

- **`src/lib/actions/admin.ts:434-468`**: SELECT, then UPDATE status, then call resolveMarket — three separate operations
- The WHERE on the UPDATE uses `eq(markets.status, market.status)` with stale status value

## Proposed Solutions

### Option A: Move status transition inside resolveMarket's transaction
Check and transition atomically — if the `UPDATE ... SET status='resolving' WHERE status=<prev>` returns 0 rows, abort. Same pattern as the oracle's idempotency guard.

### Option B: Add .returning() check before calling resolveMarket
```ts
const [updated] = await db.update(markets)
  .set({ status: "resolving" })
  .where(and(eq(markets.id, marketId), eq(markets.status, market.status)))
  .returning({ id: markets.id });
if (!updated) return { error: "Market state changed, please refresh" };
await resolveMarket(marketId);
```
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria
- [ ] Concurrent cron + resolveNow cannot both execute distributePayout
- [ ] resolveNow returns a clear error if market status changed between read and update

## Work Log
- 2026-04-06: Identified by architecture-strategist during ce:review
