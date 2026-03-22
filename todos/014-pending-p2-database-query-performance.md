---
status: pending
priority: p2
issue_id: "014"
tags: [code-review, performance, database]
dependencies: []
---

# Fix Multiple Database Query Performance Issues

## Problem Statement

Several database queries have significant performance issues that will degrade under moderate load: the leaderboard fetches all positions from all users without filtering to the top-N users; the homepage has no limit on active markets; the portfolio page runs 3 sequential queries that could be parallelized; the DB connection pool has no max configured for serverless environments.

## Findings

**Leaderboard positions (P2-E):** `src/app/leaderboard/page.tsx:22-35` — fetches ALL non-zero positions across ALL users with no userId filter. At 10,000 users × 5 positions = 50,000 rows transferred, then filtered in JS to the 100 users already known.

**Homepage no limit (P2-F):** `src/app/page.tsx:40-56` — no `.limit()` on active markets query. 500 active markets = 500 full rows (including JSONB videoMetadata) on every page load.

**Portfolio sequential queries (P3-C):** `src/app/portfolio/page.tsx:18-94` — user fetch, then positions fetch, then trades fetch — all sequential; positions and trades could run in parallel.

**DB pool no max (P3-A):** `src/db/index.ts:5` — `new Pool(...)` with no `max` option. In serverless, each function instance creates its own pool; 10 concurrent instances = 100 connections. Neon free tier limit: 100 connections.

## Proposed Solutions

**Fix 1 — Leaderboard positions filter:**
```typescript
const topUserIds = topUsers.map(u => u.id);
.where(and(ne(positions.shares, "0"), inArray(positions.userId, topUserIds)))
```

**Fix 2 — Homepage limit:**
```typescript
.orderBy(desc(markets.createdAt))
.limit(50) // add pagination link
```

**Fix 3 — Portfolio parallelization:**
```typescript
const [openPositions, recentTrades] = await Promise.all([
  db.select()...positions query...,
  db.select()...trades query...,
]);
```

**Fix 4 — Pool max:**
```typescript
const pool = new Pool({ connectionString, max: 1 }); // 1 per serverless invocation
```
Or switch to Neon's HTTP driver (`neon()`) for stateless serverless.

**Effort per fix:** All are trivial (5-30 minutes each)
**Risk:** Low for all

## Recommended Action

Apply all four fixes — each is a one-liner or near-one-liner.

## Technical Details

**Affected files:**
- `src/app/leaderboard/page.tsx:22-35`
- `src/app/page.tsx:40-56`
- `src/app/portfolio/page.tsx:18-94`
- `src/db/index.ts:5`

## Acceptance Criteria

- [ ] Leaderboard positions query includes `inArray(positions.userId, topUserIds)` filter
- [ ] Homepage active markets query has a `.limit()` applied
- [ ] Portfolio positions and trades queries run in parallel with `Promise.all`
- [ ] DB pool max is configured for serverless (max: 1 or HTTP driver)
- [ ] Leaderboard still shows correct mark-to-market values

## Work Log

### 2026-03-22 - Discovery

**By:** Performance oracle (code review)
