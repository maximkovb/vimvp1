---
title: "Neon Plain TIMESTAMP Timezone Parsing Breaks Cron Cooldown + Null Poll Row Poisons Frontend"
category: logic-errors
date: 2026-04-03
tags:
  - neon-postgres
  - drizzle-orm
  - timestamp-timezone
  - cron
  - tiktok
  - tikwm
  - polling
  - date-parsing
  - null-guard
  - swr
  - next-js
severity: high
components:
  - src/app/api/cron/poll-tiktok/route.ts
  - src/components/LiveEngagementStats.tsx
  - src/lib/market-fetcher.ts
  - src/db/schema.ts
---

## Problem

The TikTok polling cron returned `{ polled: 0, skipped: N }` on every single run. All active markets
were skipped regardless of how much time had passed since the last poll. The cron had **never**
auto-polled successfully since deployment. Additionally, when TikWM returned no data (API failure,
deleted/private video), the frontend engagement stats went completely blank and stayed blank.

**Observable symptoms:**
- Every cron run returns `skipped: 3` (or N), `polled: 0`
- View/like counts never update on the market page
- `LiveEngagementStats` component renders nothing after any TikWM failure
- Adding debug output to the cron reveals `lastPollMinsAgo: -240` — the last poll appears to have
  happened 4 hours *in the future*

---

## Root Cause

### Bug 1: Neon plain `TIMESTAMP` strings misparse on non-UTC machines

Neon Postgres returns `timestamp` (without timezone) columns as bare strings like
`"2026-04-03T00:18:13.261"` — **no `Z` suffix, no `+00` offset**.

JavaScript's `new Date(string)` treats strings without a timezone designator as **local time**, then
converts to UTC internally. On a UTC-4 machine, `"2026-04-03T00:18:13"` becomes
`2026-04-03T04:18:13Z` in UTC — a value 4 hours in the future.

The `shouldPoll` cooldown guard:
```typescript
return Date.now() - lastPollAt.getTime() >= 10 * 60 * 1000;
```
evaluated to `-14_400_000 >= 600_000` — always `false`. Every market was perpetually skipped.

> **Note:** This bug is invisible on Vercel production (which runs in UTC) and only surfaces locally
> on developer machines in non-UTC timezones. "It works in CI" is not a safe bar.

### Bug 2: Null rows from TikWM failures poison `pollHistory`

When `fetchTikTokStatsById` returned `null` (TikWM down, video deleted/private), the cron
**always** inserted a poll row with `viewCount: null, likeCount: null`. `LiveEngagementStats`
blindly read `pollHistory[pollHistory.length - 1]`, got the null row, and returned `null` —
rendering nothing. A single TikWM failure blanked the UI permanently until the next successful poll.

---

## Investigation Steps

1. Added `skipReasons` to the cron response when `marketsToPoll.length === 0`. This surfaced
   `lastPollMinsAgo: -240` — confirmed the timestamp was being treated as 4 hours in the future.
2. Traced the value path: Neon raw SQL → `db.execute()` row → `new Date(row.last_polled_at)`.
   Identified the missing `Z` as the cause.
3. Tested TikWM directly for all video IDs — 2/3 returned valid data (`code: 0`), confirming
   the API itself worked and the cron logic was the failure point.
4. Inspected `tiktok_polls` via the market detail API — found null-valued rows corresponding to
   earlier TikWM failures.

---

## Fix

### Bug 1: Use `EXTRACT(EPOCH)` to return UTC Unix milliseconds

**`src/app/api/cron/poll-tiktok/route.ts`**

```typescript
// Before — new Date(string) parses as local time on non-UTC machines
const lastPollRows = await db.execute(
  sql`SELECT market_id, MAX(polled_at) AS last_polled_at
      FROM tiktok_polls WHERE market_id = ANY(ARRAY[...]) GROUP BY market_id`
);
for (const row of lastPollRows.rows as { market_id: string; last_polled_at: Date | string; }[]) {
  lastPollByMarket.set(row.market_id, new Date(row.last_polled_at));
}

// After — epoch ms is timezone-agnostic; new Date(number) is always UTC
const lastPollRows = await db.execute(
  sql`SELECT market_id, EXTRACT(EPOCH FROM MAX(polled_at))::bigint * 1000 AS last_polled_ms
      FROM tiktok_polls WHERE market_id = ANY(ARRAY[...]) GROUP BY market_id`
);
for (const row of lastPollRows.rows as { market_id: string; last_polled_ms: string | number | bigint; }[]) {
  lastPollByMarket.set(row.market_id, new Date(Number(row.last_polled_ms)));
}
```

`EXTRACT(EPOCH FROM col)` returns Unix seconds regardless of session timezone or column type.
`::bigint * 1000` gives milliseconds. `new Date(Number(ms))` constructs from a UTC epoch — no
string parsing, no timezone ambiguity.

### Bug 2: Guard the insert on `stats !== null`

**`src/app/api/cron/poll-tiktok/route.ts`**

```typescript
// Before — always inserts, even with null stats
await db.insert(tiktokPolls).values({
  marketId: market.id,
  viewCount: stats !== null ? BigInt(stats.viewCount) : null,
  likeCount: stats !== null ? BigInt(stats.likeCount) : null,
});

// After — only persist when we have real data
if (stats !== null) {
  await db.insert(tiktokPolls).values({
    marketId: market.id,
    viewCount: BigInt(stats.viewCount),
    likeCount: BigInt(stats.likeCount),
  });
}
```

### Frontend defensive read

**`src/components/LiveEngagementStats.tsx`**

```typescript
// Before — blindly takes last row, which may be null
const latestPoll = market.pollHistory[market.pollHistory.length - 1];

// After — finds last row with actual data
const latestPollWithViews = [...market.pollHistory].reverse().find((p) => p.viewCount != null);
const latestPollWithLikes = [...market.pollHistory].reverse().find((p) => p.likeCount != null);
const latestViews = latestPollWithViews?.viewCount ?? null;
const latestLikes = latestPollWithLikes?.likeCount ?? null;
```

### Additional fixes made in the same session

- Extracted shared `marketFetcher` to `src/lib/market-fetcher.ts`. Two components each defined an
  identical `fetcher` at module scope with different references — SWR uses `(key, fetcherRef)` for
  cache identity, so two different function objects meant two independent HTTP requests per 60s cycle.
- Fixed tautological ternary `isValidating ? lastFetched : lastFetched` → `lastFetched` in
  `MarketLiveData.tsx:78`.
- Added `?force=true` query param to bypass the 10-minute cooldown for manual testing:
  `curl "…/api/cron/poll-tiktok?force=true" -H "Authorization: Bearer $CRON_SECRET"`
- Added `skipReasons` debug array to the response when all markets are skipped (includes
  `lastPollMinsAgo`, `status`, `hasResolvesAt` per market).

---

## Prevention

### Rule: Never pass a raw Neon `timestamp` string to `new Date()`

Strings from `timestamp` (no timezone) columns are bare ISO strings without a `Z`. JavaScript
treats them as local time. This only surfaces on developer machines in non-UTC timezones and is
**invisible on Vercel** (UTC). The canonical fix is to retrieve timestamps as numbers.

### Pattern: Epoch extraction for any raw SQL timestamp comparison

```typescript
// Always do this when comparing a raw SQL timestamp to Date.now()
EXTRACT(EPOCH FROM col)::bigint * 1000 AS col_ms
// Then: new Date(Number(row.col_ms))
```

### Schema-level fix: use `timestamptz`

Change `timestamp("col", { mode: "date" })` to `timestamp("col", { mode: "date", withTimezone: true })`
for any column used in scheduling, ordering, or recency logic. Postgres will store as UTC and return
values with offset info, making `new Date(string)` safe.

```typescript
// Drizzle schema fix
polledAt: timestamp("polled_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
```

Migration: `ALTER TABLE tiktok_polls ALTER COLUMN polled_at TYPE timestamptz USING polled_at AT TIME ZONE 'UTC';`

### Detect during code review

Flag any of these patterns:
- `new Date(row.someCol)` where `someCol` is a raw DB result field
- Drizzle column `timestamp("…", { mode: "date" })` without `withTimezone: true` used in comparisons
- Cron/scheduler logic that filters rows by recency — highest risk for silent "skip all" failures

### Test across timezones

Run scheduling/cron unit tests with `TZ=America/New_York` and `TZ=UTC` — results must be identical:
```bash
TZ=America/New_York npx jest --testPathPattern=cron
TZ=UTC              npx jest --testPathPattern=cron
```

---

## Cross-References

- [`docs/solutions/database-issues/nextjs-financial-app-code-review-patterns.md`](../database-issues/nextjs-financial-app-code-review-patterns.md) — Pattern 10 (UTC
  Normalization) covers the same class of timezone bug in the daily-reward cron. Pattern 5 (Cron
  Lifecycle State Machine Gaps) and Pattern 9 (DB Index on Polling Hot Path) are also applicable.
- [`docs/solutions/logic-errors/tiktok-market-resolution-race-condition.md`](./tiktok-market-resolution-race-condition.md) — covers poll interval
  dual-location config, `active → halted → resolving` guard, and BigInt comparison requirement.
  The `shouldPoll` function fixed here is documented in that file.
- **SWR gap:** No `docs/solutions/` entry covers SWR polling patterns. The shared-fetcher-reference
  fix (SWR dedup requires identical function identity) is worth a dedicated doc if this pattern
  recurs.
