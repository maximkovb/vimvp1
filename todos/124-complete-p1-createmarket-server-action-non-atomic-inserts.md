---
name: createMarket server action has 3 non-atomic DB inserts
description: market row, price snapshot, and initial poll inserted separately in admin.ts — process crash between any two leaves orphaned market data
type: bug
status: pending
priority: p1
issue_id: "124"
tags: [code-review, architecture, data-integrity, transactions]
dependencies: []
---

## Problem Statement

`createMarket()` in `src/lib/actions/admin.ts:192-232` performs three separate DB inserts:
1. `db.insert(markets)` — the market row
2. `db.insert(priceSnapshots)` — initial price snapshot
3. `db.insert(tiktokPolls)` — initial poll baseline

These are not wrapped in a transaction. A crash, Neon connection drop, or serverless timeout between any two creates an orphaned market with missing poll data. The oracle will then throw `No poll data for market ${marketId}` and mark the market as `failed` on the first cron run.

**Why:** The API route (`POST /api/markets`) and `createTestMarket` both correctly use `db.transaction()` for this pattern, but the server action was written without the transaction wrapper.

## Findings

- **`src/lib/actions/admin.ts:192-232`**: Three sequential `await db.insert()` calls outside a transaction
- Contrast with `src/lib/actions/admin.ts:388` (`createTestMarket`) which correctly wraps all three in `db.transaction()`
- Contrast with `src/app/api/markets/route.ts` which also uses a transaction

## Proposed Solutions

### Option A: Wrap all three inserts in db.transaction() (Recommended)
```ts
await db.transaction(async (tx) => {
  const [newMarket] = await tx.insert(markets).values({...}).returning();
  await tx.insert(priceSnapshots).values({...});
  if (platform === "tiktok") {
    await tx.insert(tiktokPolls).values({...});
  }
  return newMarket;
});
```
- **Effort:** Small
- **Risk:** Very low — same pattern already used in createTestMarket

## Acceptance Criteria
- [ ] All three inserts are inside a single `db.transaction()` call
- [ ] If any insert fails, all are rolled back
- [ ] No orphaned market records possible from this code path

## Work Log
- 2026-04-06: Identified by architecture-strategist during ce:review
