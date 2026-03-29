---
status: pending
priority: p1
issue_id: "008"
tags: [code-review, performance]
dependencies: []
---

# Fix Two O(N) Unbounded Queries: Poll History Fetch and Volume Subquery

## Problem Statement

Two queries grow without bound as the application runs: (1) `poll-youtube` fetches every historical poll record for all active markets to find the latest per market — this grows to millions of rows over months. (2) Every trade triggers a correlated `SUM(ABS(cost))` subquery on the entire `trades` table per market inside the trade transaction — adding O(trades) cost to every buy/sell.

## Findings

**Issue A — Unbounded poll history fetch:**
- `src/app/api/cron/poll-youtube/route.ts:74-84`: `SELECT * FROM youtube_polls WHERE market_id IN (...)` — no time filter, no limit
- At 5-min polling for one market over 90 days: ~25,000 rows; 50 markets: 1.25M rows transferred per cron tick
- All rows loaded into memory to build a Map and find the max `polledAt` per market

**Issue B — Volume subquery on every trade:**
- `src/lib/actions/trade.ts:221-224` and `362-365`: embedded correlated subquery `SELECT SUM(ABS(cost)) FROM trades WHERE market_id = ?` inside INSERT priceSnapshots
- Runs a full indexed scan aggregating all historical trades on every buy and sell
- At 10,000 trades per market: adds ~50ms per trade; at 100,000: proportionally worse

## Proposed Solutions

### Option A — Fix Poll History Query

Replace the bulk fetch with a GROUP BY aggregate:
```typescript
const lastPollRows = await db.execute(sql`
  SELECT market_id, MAX(polled_at) as last_polled_at
  FROM youtube_polls
  WHERE market_id = ANY(${marketIds})
  GROUP BY market_id
`);
```
Returns exactly 1 row per market regardless of history depth.

Also add composite index to schema.ts:
```typescript
index("youtube_polls_market_polled_idx").on(table.marketId, table.polledAt)
```

### Option B — Fix Volume Subquery

Track running `volumeTotal` on the `markets` table, increment atomically during the same UPDATE that already modifies quantities and version:

```typescript
// In the markets UPDATE:
.set({
  quantityYes: ...,
  quantityNo: ...,
  version: sql`${markets.version} + 1`,
  volumeTotal: sql`${markets.volumeTotal} + ${actualCost.toFixed(2)}`,  // new column
})
```

Then reference `market.volumeTotal + actualCost` directly in the priceSnapshot INSERT.

**Migration needed:** Add `volume_total` decimal column to `markets` table.

**Effort (A):** 1 hour | **Risk:** Low
**Effort (B):** 2 hours | **Risk:** Low (additive migration)

## Recommended Action

Fix both. Option A (poll query) has no migration and fixes an immediate scalability bomb. Option B (volume subquery) is lower urgency but eliminates a latent hot-path cost.

## Technical Details

**Affected files:**
- `src/app/api/cron/poll-youtube/route.ts:74-84` — poll query
- `src/lib/actions/trade.ts:221-224`, `362-365` — volume subquery (both buyShares and sellShares)
- `src/db/schema.ts` — add composite index + optional volumeTotal column
- `src/app/api/cron/resolve-markets/route.ts:84-89` — also benefits from the composite index (determineOutcome uses ORDER BY polledAt DESC LIMIT 1)

## Acceptance Criteria

- [ ] `poll-youtube` cron fetches at most 1 row per active market (via GROUP BY MAX)
- [ ] Composite index `(marketId, polledAt)` exists on `youtubePolls`
- [ ] `priceSnapshots` INSERT no longer contains a correlated subquery against `trades`
- [ ] Trade latency is not affected by historical trade count for a market
- [ ] `determineOutcome` in resolve-markets uses the composite index efficiently

## Work Log

### 2026-03-22 - Discovery

**By:** Performance oracle (code review)
