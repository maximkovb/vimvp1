---
title: Market Resolution Pipeline — Payout Correctness Bugs
date: 2026-04-19
category: logic-errors
module: market-resolution
problem_type: logic_error
component: service_object
severity: critical
symptoms:
  - YES bettors paid nothing when milestone is met; NO bettors paid instead
  - Concurrent cron + manual resolution can pay two different outcome sides
  - Resolved markets overwritten as failed by error-handler race
  - Float precision loss on share-based payout amounts
root_cause: logic_error
resolution_type: code_fix
tags: [market-resolution, payout, oracle, cron, concurrency, float-precision, status-guard, double-payment]
---

# Market Resolution Pipeline — Payout Correctness Bugs

## Problem

Eight distinct bugs in the market resolution pipeline caused incorrect, duplicate, or missed payouts. The most severe inverted the outcome encoding in the oracle, paying NO bettors when a video hit its milestone and YES bettors when it didn't. Several bugs compounded: the inverted outcome, combined with an unchecked concurrent-resolve path, meant two simultaneous resolvers could each pay a different side of the same market.

## Symptoms

- YES bettors receive no payout when the video milestone is met; NO bettors receive coins instead
- When cron and admin manual-resolve fire concurrently, distributePayout may run twice with different outcomes
- A market resolved successfully by a concurrent worker is overwritten to `status='failed'` by the catch handler
- Post-resolution, winning positions still show `shares > 0` (inconsistent position state)
- Share-based payouts contain IEEE-754 float rounding artifacts (e.g., `1.0000000000000002` instead of `1.00`)
- Trades can slip through the trade-window gap if a market reaches `resolvesAt` without passing through the halt window

## What Didn't Work

- **The oracle inversion and any-poll-ever fix were already documented** in `docs/solutions/logic-errors/market-outcome-resolution-and-display.md` (2026-04-16) but were never applied to the code. The bug persisted in production through the next review cycle because documentation was written without a corresponding code commit.

## Solution

Eight fixes applied across four files:

### Fix 1 — Oracle: correct outcome encoding (`src/lib/oracle.ts`)

The condition `metric >= milestoneThreshold ? 1 : 0` was inverted relative to the schema (`0=YES, 1=NO`).

**Before:**
```typescript
const outcome = metric !== null && metric >= market.milestoneThreshold ? 1 : 0;
```

**After:**
```typescript
// 0=YES (milestone ever met), 1=NO — matches schema convention 0=YES/1=NO
const outcome = crossedPoll !== undefined ? 0 : 1;
```

### Fix 2 — Oracle: any-poll-ever resolution semantics (`src/lib/oracle.ts`)

The oracle previously fetched only the latest TikTok poll and compared its metric. TikTok normalises historical counts downward over time, so a milestone that was crossed at peak could later appear as missed. The fix queries for any poll that ever crossed the threshold.

**Before:**
```typescript
const [latestPoll] = await db.select().from(tiktokPolls)
  .where(eq(tiktokPolls.marketId, marketId))
  .orderBy(desc(tiktokPolls.recordedAt))
  .limit(1);
const metric = market.questionType === "views" ? latestPoll?.viewCount : latestPoll?.likeCount;
const outcome = metric !== null && metric >= market.milestoneThreshold ? 1 : 0;
```

**After:**
```typescript
const metricColumn = market.questionType === "views"
  ? tiktokPolls.viewCount : tiktokPolls.likeCount;
const [crossedPoll] = await db.select({ id: tiktokPolls.id }).from(tiktokPolls)
  .where(and(eq(tiktokPolls.marketId, marketId), gte(metricColumn, market.milestoneThreshold)))
  .limit(1);
const outcome = crossedPoll !== undefined ? 0 : 1;
```

### Fix 3 — Oracle: guard distributePayout behind rows-affected check (`src/lib/oracle.ts`)

Previously `distributePayout` was called unconditionally even if the `UPDATE markets SET status='resolved'` matched 0 rows (market already resolved by a concurrent worker). The fix checks `.returning()` and returns early if no rows were updated.

**Before:**
```typescript
await tx.update(markets)
  .set({ status: "resolved", outcome, resolvedAt: now })
  .where(and(eq(markets.id, marketId), eq(markets.status, "resolving")));
await distributePayout(tx, marketId, outcome);
```

**After:**
```typescript
const updated = await tx.update(markets)
  .set({ status: "resolved", outcome, resolvedAt: now })
  .where(and(eq(markets.id, marketId), eq(markets.status, "resolving")))
  .returning({ id: markets.id });
if (updated.length === 0) return; // concurrent worker already resolved
await distributePayout(tx, marketId, outcome);
```

### Fix 4 — payout.ts: zero winning shares after payout (`src/lib/services/payout.ts`)

`distributePayout` left winning shares untouched after paying out. `refundPositions` zeroed shares on refund; payout should too. Without this, position state is stale post-resolution and future calls to `distributePayout` rely solely on the `coinTransactions` idempotency check rather than having a second guard.

**Added after the coin_transactions INSERT:**
```typescript
await tx.execute(sql`
  UPDATE positions
  SET shares = '0'
  WHERE market_id = ${marketId}
    AND outcome = ${outcome}
    AND shares != '0'
`);
```

### Fix 5 — payout.ts: Postgres ROUND instead of JS toFixed (`src/lib/services/payout.ts`)

`refundPositions` used `parseFloat(shares) * parseFloat(avgCostBasis)` then `.toFixed(2)` in JS. This introduces IEEE-754 float loss before the string is passed to Postgres. The fix passes raw share strings directly and rounds in Postgres.

**Before:**
```typescript
refundAmount: (parseFloat(p.shares) * parseFloat(p.avgCostBasis)).toFixed(2),
```

**After (in SQL template):**
```sql
ROUND(${p.shares}::numeric, 2)
```

### Fix 6 — cron: status guard in catch handler (`src/app/api/cron/resolve-markets/route.ts`)

The error catch handler wrote `status='failed'` unconditionally. If a concurrent cron worker successfully resolved the same market (completing its transaction), the first worker's catch path would overwrite `status='resolved'` with `status='failed'`. The fix adds an `eq(markets.status, "resolving")` guard.

**Before:**
```typescript
await db.update(markets).set({ status: "failed" }).where(eq(markets.id, market.id));
```

**After:**
```typescript
await db.update(markets).set({ status: "failed" })
  .where(and(eq(markets.id, market.id), eq(markets.status, "resolving")));
```

### Fix 7 — cron: two-step safety-net halt (`src/app/api/cron/resolve-markets/route.ts`)

The safety net for markets that reached `resolvesAt` without passing through the halt window used a direct `active→resolving` transition. This bypasses the trade-closing halt step, leaving a window where trades pass the `status='active'` guard while resolution is underway. The fix mirrors the primary path: first halt, then resolving.

**Before:**
```typescript
await db.update(markets).set({ status: "resolving" })
  .where(and(eq(markets.status, "active"), sql`${markets.resolvesAt} <= ${now}`));
```

**After:**
```typescript
await db.update(markets).set({ status: "halted" })
  .where(and(eq(markets.status, "active"), sql`${markets.resolvesAt} <= ${now}`));
await db.update(markets).set({ status: "resolving" })
  .where(and(eq(markets.status, "halted"), sql`${markets.resolvesAt} <= ${now}`));
```

### Fix 8 — admin resolve: rows-affected guard (`src/app/api/admin/markets/[id]/resolve/route.ts`)

The admin manual-resolve route called `distributePayout` after the UPDATE without checking whether any rows matched. Added `.returning()` and a 422 early return if 0 rows updated.

**Before:**
```typescript
await tx.update(markets).set({ status: "resolved", outcome, resolvedAt: new Date() })
  .where(and(eq(markets.id, id), or(eq(markets.status, "failed"), eq(markets.status, "resolving"))));
await distributePayout(tx, id, outcome);
```

**After:**
```typescript
const updated = await tx.update(markets)
  .set({ status: "resolved", outcome, resolvedAt: new Date() })
  .where(and(eq(markets.id, id), or(eq(markets.status, "failed"), eq(markets.status, "resolving"))))
  .returning({ id: markets.id });
if (updated.length === 0) {
  return { error: "Market is no longer in failed or resolving status", status: 422 } as const;
}
await distributePayout(tx, id, outcome);
```

## Why This Works

The oracle inversion was a pure sign error: the conditional produced `1` (NO) when the milestone was met and `0` (YES) when it wasn't, which is exactly backwards against the schema's `0=YES / 1=NO` convention.

The any-poll-ever fix is correct because TikTok normalises historical view/like counts downward as videos age. A point-in-time check against the latest poll can reverse a milestone crossing that was genuinely reached at peak. The `gte` filter on the full poll history is the correct predicate: if the threshold was ever crossed in a recorded poll, the outcome is YES.

The rows-affected guards (Fixes 3 and 8) close the concurrent-resolve double-payment window. The unique constraint on `coin_transactions(userId, referenceId, type)` catches same-outcome duplicates, but it cannot protect against two resolvers using different outcomes — the only correct guard is "don't call distributePayout if you didn't win the status update race."

Zeroing winning shares after payout (Fix 4) ensures `distributePayout` is idempotent through both of its guards (the `alreadyPaid` coinTransactions check and the `shares != '0'` filter), matching the behaviour of `refundPositions`.

The safety-net two-step (Fix 7) ensures every market passes through the `halted` state before becoming `resolving`. This is required because the trade-execution path checks `status='active'` before inserting a trade. Bypassing the halt step creates a window where a trade passes that check while a concurrent resolution is computing payouts.

## Prevention

- **Always check `.returning()` after any `UPDATE … WHERE status = X` that gates critical downstream work.** If 0 rows were updated, a concurrent worker already claimed the transition. Return or throw rather than proceeding.

- **Never use direct `active→resolving` transitions.** Every path that moves a market to `resolving` must halt it first to close the trade window. Audit any new code path that touches `status='resolving'` to confirm it goes through `halted`.

- **Do arithmetic on monetary amounts in Postgres, not JavaScript.** Pass raw numeric strings and use `ROUND(value::numeric, 2)`. Never `parseFloat().toFixed(2)` for coin amounts.

- **Mirror share-zeroing across all settlement paths.** If `refundPositions` zeroes shares, `distributePayout` must too. Any new settlement variant (partial resolution, split outcome, etc.) must include a shares-zeroing step.

- **Validate schema conventions in integration tests, not just unit tests.** The outcome inversion survived a unit test suite that mocked the oracle. A test that places YES bets, triggers resolution with a milestone-crossing poll, and asserts YES-bettors received coins would have caught this immediately.

- **Apply documented fixes promptly.** The oracle inversion and any-poll-ever semantics were documented in `docs/solutions/logic-errors/market-outcome-resolution-and-display.md` on 2026-04-16 but never applied. Documentation without a corresponding code change is debt that compounds.

## Related Issues

- `docs/solutions/logic-errors/market-outcome-resolution-and-display.md` — documents the original oracle inversion discovery and any-poll-ever semantics (2026-04-16)
- `docs/solutions/logic-errors/tiktok-market-resolution-race-condition.md` — documents the halt-before-resolve two-step pattern that the safety-net bypass violated
- `docs/solutions/database-issues/nextjs-financial-app-code-review-patterns.md` Pattern 5 — shows direct `active→resolving` as the safety-net pattern; **this is now incorrect and should be updated to show the two-step halt**
