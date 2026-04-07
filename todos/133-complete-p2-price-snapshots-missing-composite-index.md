---
name: priceSnapshots missing composite index for market+time queries
description: Frequent (market_id, recorded_at) query pattern hits two separate indexes instead of one composite — slow at scale
type: performance
status: pending
priority: p2
issue_id: "133"
tags: [code-review, performance, database, indexes]
dependencies: []
---

## Problem Statement

`price_snapshots` has separate indexes on `market_id` and `recorded_at`, but every query uses `WHERE market_id = ? ORDER BY recorded_at` (in `/api/markets/[id]` and `markets/[id]/page.tsx`). Postgres uses a bitmap AND or single-column index + sort instead of a single composite scan. With 100 trades/day × 500 markets, this table grows to 50K+ rows/day — the missing composite index will cause visible query slowdowns.

## Findings

- **`src/db/schema.ts:200-205`**: two separate single-column indexes instead of one composite
- Used in `src/app/api/markets/[id]/route.ts` and `src/app/markets/[id]/page.tsx`

## Proposed Solutions

### Option A: Add composite index (Recommended)
In schema.ts `priceSnapshots` table definition:
```ts
index("price_snapshots_market_recorded_idx").on(table.marketId, table.recordedAt)
```
Then create a migration. The existing `price_snapshots_market_id_idx` can be dropped as the composite subsumes it for this query pattern.
- **Effort:** Small (schema + migration)
- **Risk:** None — additive index, migration is safe

## Acceptance Criteria
- [ ] Composite index `(market_id, recorded_at)` exists in schema
- [ ] Migration applied
- [ ] `EXPLAIN ANALYZE` shows index scan for market price history queries

## Work Log
- 2026-04-06: Identified by performance-oracle during ce:review
