# Todo 008 Result — Fix Unbounded Poll History Query and Volume Subquery

## Files Changed

- `src/app/api/cron/poll-youtube/route.ts`
- `src/lib/actions/trade.ts`
- `src/db/schema.ts`

## Summary of Changes

### Part A — poll-youtube unbounded query (route.ts)

Replaced the full-table fetch of all historical `youtube_polls` rows (one row per poll per market) with a single aggregated `GROUP BY` query using `db.execute(sql`...`)`. The new query retrieves only one row per market (the MAX `polled_at`), eliminating unbounded memory growth as poll history accumulates.

- Removed: `db.select().from(youtubePolls).where(inArray(...))` and the in-memory max-finding loop
- Added: raw SQL `SELECT market_id, MAX(polled_at) ... GROUP BY market_id` with `sql.join` for parameterized market IDs
- Updated import: removed unused `inArray` and `and`; added `sql` from `drizzle-orm`

### Part B — Remove volume subquery from trades (trade.ts)

Removed the correlated subquery `SELECT COALESCE(SUM(ABS(CAST(cost AS NUMERIC))), 0) FROM trades WHERE market_id = ...` from both the `buyShares` and `sellShares` `priceSnapshots` INSERT statements. The `volumeTotal` field is now omitted entirely, letting it fall back to the schema default of `"0"`. This eliminates a full table scan on `trades` inside every transaction.

### Part C — Composite index on youtubePolls (schema.ts)

Added a composite index `youtube_polls_market_polled_idx` on `(marketId, polledAt)` to the `youtubePolls` table. This supports the new `GROUP BY MAX(polled_at)` query efficiently — the database can satisfy the query using the index alone (index scan + aggregate), avoiding a sequential scan.

## Blockers / Simplifications

- Part B simplification: `volumeTotal` will now always be `"0"` in `price_snapshots`. If this column is used for display or analytics, it will need a separate backfill or a different mechanism (e.g., a background job or trigger) to maintain accurate values. This was the explicitly requested approach.
- Part C requires a schema migration to be generated and applied (`drizzle-kit generate` + `drizzle-kit migrate`) before the new index takes effect in the database.
