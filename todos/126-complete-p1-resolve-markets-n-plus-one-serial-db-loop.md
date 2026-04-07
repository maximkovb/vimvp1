---
name: resolve-markets cron serial N+1 DB queries — can exceed 60s Vercel timeout
description: Each resolveMarket() call in the cron loop issues 2 additional DB queries, serialized through max:1 Neon connection
type: bug
status: pending
priority: p1
issue_id: "126"
tags: [code-review, performance, cron, database]
dependencies: []
---

## Problem Statement

`src/app/api/cron/resolve-markets/route.ts` fetches all `resolving` markets, then calls `resolveMarket(market.id)` in a `for` loop. Inside `resolveMarket`, the market is fetched again (`SELECT FROM markets`) and then the latest poll is fetched (`SELECT FROM tiktokPolls`), then a transaction with multiple writes runs. With N resolving markets, this is `3 + (4 × N)` round trips through the single Neon connection. At 5+ simultaneous resolutions, the 60-second Vercel function timeout is easily hit.

**Why:** `resolveMarket()` was designed as a standalone function without considering the batch context of the cron.

## Findings

- **`src/app/api/cron/resolve-markets/route.ts:43-57`**: `for` loop calling `resolveMarket()` sequentially
- **`src/lib/oracle.ts:19-32`**: Re-fetches market + latest poll that the cron already has
- Performance agent analysis: `3 + (4 × N)` DB round trips for N markets

## Proposed Solutions

### Option A: Batch-fetch latest polls before the loop (Recommended)
Use `DISTINCT ON (market_id) ORDER BY market_id, polled_at DESC` to fetch the latest poll for all resolving markets in one query. Pass both `market` and `latestPoll` to a refactored `resolveMarketWithData(market, poll, tx)` function. Eliminates 2 queries per market.
- **Effort:** Medium
- **Risk:** Medium — refactors oracle.ts signature

### Option B: Accept the current behavior for small scale
At <10 simultaneous resolutions the timeout risk is low.
- **Effort:** None
- **Risk:** Time bomb as market count grows

## Acceptance Criteria
- [ ] `resolve-markets` cron with 10 simultaneous resolutions completes in <30s
- [ ] No redundant market or poll re-fetches inside resolveMarket when called from cron

## Work Log
- 2026-04-06: Identified by performance-oracle during ce:review
