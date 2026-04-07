---
name: volumeTotal column never written — always displays 0
description: priceSnapshots.volumeTotal defaults to "0" and is never updated on trade; UI displays incorrect cumulative volume
type: bug
status: pending
priority: p2
issue_id: "128"
tags: [code-review, architecture, data-integrity]
dependencies: []
---

## Problem Statement

`volumeTotal` is defined in the `priceSnapshots` table (`schema.ts`) with `.default("0")`, but neither `buyShares` nor `sellShares` writes it. Every snapshot insert omits the field. `MarketLiveData.tsx:153` reads `market.priceHistory[last].volumeTotal` and displays it as "total volume" in the `HaltCountdownBlock` — it will always show 0.

## Findings

- **`src/lib/actions/trade.ts:231`** (`buyShares` snapshot insert): no `volumeTotal`
- **`src/lib/actions/trade.ts:374`** (`sellShares` snapshot insert): no `volumeTotal`
- **`src/components/MarketLiveData.tsx:153`**: reads `volumeTotal` for display

## Proposed Solutions

### Option A: Accumulate volume on each snapshot insert
Add to both snapshot inserts:
```ts
volumeTotal: sql`COALESCE((SELECT volume_total FROM price_snapshots WHERE market_id = ${marketId} ORDER BY recorded_at DESC LIMIT 1), 0) + ${actualCost.toFixed(2)}`
```
- **Effort:** Small (2 SQL additions)
- **Risk:** Low

### Option B: Remove volumeTotal from schema and UI if unused
If cumulative volume is not a product requirement, drop the column and the display.
- **Effort:** Small (migration + UI change)

## Acceptance Criteria
- [ ] After a buy or sell, `volumeTotal` in the latest snapshot reflects cumulative trade volume for that market
- [ ] `HaltCountdownBlock` shows a non-zero value after any trades

## Work Log
- 2026-04-06: Identified by architecture-strategist during ce:review
