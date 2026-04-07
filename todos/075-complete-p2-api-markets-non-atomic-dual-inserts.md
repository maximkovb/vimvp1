---
status: pending
priority: p2
issue_id: "075"
tags: [code-review, performance, architecture, api]
dependencies: []
---

# `POST /api/markets` has non-atomic dual DB inserts — orphaned markets if crash between writes

## Problem Statement

When `publishImmediately: true`, `POST /api/markets` performs two sequential `await db.insert()` calls — one for the `markets` row and one for the initial `priceSnapshots` row — without a transaction. If the process crashes, times out, or the Neon serverless connection drops between the two inserts, the result is a `markets` row with no price snapshot. A market in this state has no pricing, breaking the LMSR price display and any downstream cron job that reads prices.

Neon serverless uses max 1 connection pool, so under concurrent requests the second insert may also queue behind other queries, increasing the window for this failure.

## Findings

```typescript
// src/app/api/markets/route.ts lines 90–100:
await db.insert(markets).values({ ... });  // commit point 1

if (data.publishImmediately) {
  const prices = allPrices([0, 0], data.bParameter);
  await db.insert(priceSnapshots).values({ ... });  // commit point 2
}
```

No `db.transaction()` wrapper. If line 97 fails, the `markets` row persists with no snapshot. The same dual-insert pattern in `createMarket()` in `admin.ts` has the same issue.

## Proposed Solution

Wrap in a transaction:

```typescript
await db.transaction(async (tx) => {
  await tx.insert(markets).values({
    id: marketId,
    // ...all market fields
  });

  if (data.publishImmediately) {
    const prices = allPrices([0, 0], data.bParameter);
    await tx.insert(priceSnapshots).values({
      marketId,
      priceYes: prices[0].toFixed(6),
      priceNo: prices[1].toFixed(6),
    });
  }
});
```

This also reduces round-trips from 2 → 1 under the single Neon connection pool, improving throughput under concurrent creation.

Apply the same fix to `createMarket()` in `admin.ts` for parity.

- **Effort**: Small
- **Risk**: Low — pure safety improvement; transaction rollback is the desired behavior on failure

## Acceptance Criteria

- [ ] `POST /api/markets` with `publishImmediately: true` creates market + snapshot atomically
- [ ] If the snapshot insert fails, the market row is also rolled back (no orphan)
- [ ] `createMarket()` in `admin.ts` has the same transaction wrapper
- [ ] TypeScript compiles clean; no test regressions

## Work Log

- 2026-03-27: Identified during `/ce:review` — performance-oracle (P2)
