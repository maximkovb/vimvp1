---
name: History page unbounded 500-row fetch with no pagination
description: src/app/history/page.tsx fetches up to 500 trades on every load — active traders hit ceiling, response payload is large
type: performance
status: pending
priority: p2
issue_id: "135"
tags: [code-review, performance, pagination, ux]
dependencies: []
---

## Problem Statement

`src/app/history/page.tsx` fetches `.limit(500)` trades on every page load, rendered as a full server-side HTML table. Active traders will hit this ceiling. The response is large (8 numeric fields + timestamps per row). No pagination UI or infinite scroll exists.

## Findings

- **`src/app/history/page.tsx:23`**: `.limit(500)` with no pagination
- The existing `trades_created_at_idx` index supports efficient cursor pagination

## Proposed Solutions

### Option A: Cursor-based pagination
Reduce `.limit(50)` and add `?cursor=<lastTradeCreatedAt_id>` to the URL. Uses `createdAt` as the cursor alongside `id` for stable ordering.
- **Effort:** Medium (URL params + UI next-page button)
- **Risk:** Low

### Option B: Reduce limit to 100 without pagination
Quick fix — reduces payload, still not infinite. Acceptable for now.
- **Effort:** Tiny

## Acceptance Criteria
- [ ] Default history page shows 50–100 most recent trades
- [ ] "Load more" / pagination available for active traders
- [ ] Active traders with >100 trades can access full history

## Work Log
- 2026-04-06: Identified by performance-oracle during ce:review
