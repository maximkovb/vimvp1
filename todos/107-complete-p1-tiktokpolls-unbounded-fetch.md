---
status: pending
priority: p1
issue_id: "107"
tags: [code-review, performance, database]
dependencies: []
---

# Replace tiktokPolls JS dedup with SQL `DISTINCT ON`

## Problem Statement

`page.tsx` fetches ALL poll rows for all feed market IDs ordered by `polledAt DESC`, then discards all but the first row per market in a JavaScript loop. With 50 markets polled every few minutes, this query can return thousands of rows and throw away 99% of them. The existing composite index on `(marketId, polledAt)` is perfectly suited for a `DISTINCT ON` query.

## Findings

- `src/app/page.tsx:40-57`: fetches all rows with `inArray(tiktokPolls.marketId, feedIds).orderBy(desc(tiktokPolls.polledAt))`, deduplicates in JS
- `src/db/schema.ts:224`: composite index `tiktok_polls_market_polled_idx` on `(marketId, polledAt)` already exists — unused by current query
- Performance agent: at 50 markets × hourly polls over weeks = potentially tens of thousands of rows fetched per page load
- Neon serverless pool `max: 1` — this query holds the single connection while transferring a large result set

## Proposed Solutions

### Option 1: SQL `DISTINCT ON (market_id)`

**Approach:** Use Drizzle's `sql` template to issue a single `DISTINCT ON` query:

```ts
import { sql } from "drizzle-orm";

const pollRows = feedIds.length > 0
  ? await db.execute(sql`
      SELECT DISTINCT ON (market_id) market_id, view_count, like_count
      FROM tiktok_polls
      WHERE market_id = ANY(ARRAY[${sql.join(feedIds.map(id => sql`${id}`), sql`, `)}]::uuid[])
      ORDER BY market_id, polled_at DESC
    `)
  : { rows: [] };
const pollData = pollRows.rows.map(r => ({
  marketId: r.market_id as string,
  viewCount: r.view_count as bigint | null,
  likeCount: r.like_count as bigint | null,
}));
```

**Pros:** One index scan, returns at most N rows (one per market), no JS dedup loop
**Cons:** Raw SQL (less Drizzle-idiomatic); needs cast handling for bigint columns

**Effort:** 30 minutes
**Risk:** Low — the existing index covers this exactly

### Option 2: Drizzle subquery with row_number window function

**Approach:** Use a subquery to select the row with the highest `polledAt` per market via `ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY polled_at DESC)`.

**Pros:** Fully typed via Drizzle
**Cons:** More complex query builder syntax

**Effort:** 1 hour
**Risk:** Low

## Recommended Action

Option 1 is fast and uses the existing index directly. Add a comment referencing the index.

## Technical Details

**Affected files:**
- `src/app/page.tsx:40-57`

**Related:** `src/db/schema.ts:224` — `tiktok_polls_market_polled_idx` composite index already exists

## Acceptance Criteria

- [ ] Poll query returns at most `feedMarkets.length` rows
- [ ] Query uses the `tiktok_polls_market_polled_idx` index (verify via `EXPLAIN`)
- [ ] `currentCount` in FeedCard still reflects the latest poll value

## Work Log

### 2026-04-05 - Found in code review

**By:** Claude Code (performance-oracle agent)
