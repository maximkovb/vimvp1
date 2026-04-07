---
status: complete
priority: p1
issue_id: "036"
tags: [code-review, performance, database]
dependencies: []
---

# Missing Composite Index on `youtubePolls (marketId, polledAt)`

## Problem Statement

The market detail page queries `youtubePolls WHERE marketId = ? ORDER BY polledAt LIMIT 500`. Without a composite index on `(marketId, polledAt)`, this executes as a full table scan + sort for every page render. As the table grows across all markets the query degrades from milliseconds to seconds, directly blocking page load since this query runs in the critical path (not behind Suspense).

## Findings

- `page.tsx` queries `youtubePolls` with `WHERE marketId = id ORDER BY polledAt LIMIT 500`
- Drizzle schema in `src/db/schema.ts` was not verified to have a `(marketId, polledAt)` composite index
- At 100 markets × 500 polls = 50,000 rows, every market page render triggers a 50,000-row scan
- At 1,000 markets the table reaches 500,000 rows — query becomes unusable
- Neon's single-connection constraint means this slow query blocks all other DB work for that render
- Performance oracle confirmed: hot-path `ORDER BY polledAt DESC LIMIT N` queries **require** a composite index (also corroborated by `docs/solutions/database-issues/nextjs-financial-app-code-review-patterns.md`)

## Proposed Solutions

### Solution A: Add composite index in schema.ts (Recommended)
Add `index("youtube_polls_market_polled_idx").on(youtubePolls.marketId, youtubePolls.polledAt)` to the `youtubePolls` table definition in `src/db/schema.ts`, then run `drizzle-kit push` (remember: `config({ path: ".env.local" })` in `drizzle.config.ts`).
- **Pros**: Permanent fix, query goes from O(N) to O(log N), no application code change needed
- **Cons**: Requires a migration/push step
- **Effort**: Small
- **Risk**: Low — adding an index is non-destructive

### Solution B: Reduce the LIMIT
Lower `.limit(500)` to `.limit(100)` to reduce scan size in the short term.
- **Pros**: Immediate, no migration
- **Cons**: Doesn't fix the scan — just reduces impact. Chart quality degrades.
- **Effort**: Trivial
- **Risk**: Low but incomplete

## Recommended Action

Solution A. The index is the correct fix. Run `drizzle-kit push` after adding it.

## Technical Details

- **Affected files**: `src/db/schema.ts`, `drizzle.config.ts`
- **Query location**: `src/app/markets/[id]/page.tsx` lines 61-65

## Acceptance Criteria

- [ ] `src/db/schema.ts` defines `index("youtube_polls_market_polled_idx").on(youtubePolls.marketId, youtubePolls.polledAt)`
- [ ] Migration/push applied to the Neon database
- [ ] `EXPLAIN ANALYZE` on the query confirms index scan instead of seq scan
- [ ] Market detail page load time is unaffected as `youtubePolls` table grows

## Work Log

- 2026-03-23: Identified by performance-oracle and learnings-researcher during code review of feat/video-intelligence-panel
