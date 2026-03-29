---
title: "feat: Dashboard — portfolio P&L, leaderboard win rate, history page"
type: feat
status: active
date: 2026-03-29
---

# feat: Dashboard — portfolio P&L, leaderboard win rate, history page

## Overview

Three targeted improvements to the user-facing dashboard pages:

1. **Portfolio** (`/portfolio`) — already has live LMSR value and unrealized P&L for open
   positions; add realized P&L (cost basis vs payout) to the resolved section, handle
   cancelled markets, and replace the truncated 20-trade history section with a link to
   the new History page.
2. **Leaderboard** (`/leaderboard`) — add a win rate column (wins / resolved markets with
   a position).
3. **History** (`/history`) — new page listing every trade with market link, timestamp,
   buy/sell badge, outcome, shares, and cost. Add to Navbar.

## Problem Statement / Motivation

- The resolved-positions table in Portfolio shows "Won/Lost" + payout but not net P&L
  (payout minus what the user paid). Without cost basis, users can't see their actual profit
  on a closed bet.
- Cancelled markets with remaining shares silently appear in the active-positions table with
  a real LMSR value but no Sell button — confusing.
- The 20-trade cap at the bottom of Portfolio is too shallow to be useful as a history.
  A dedicated History page with all trades is the right home for that data.
- The Leaderboard shows total coin value but omits win rate, which is a key signal of
  prediction skill vs. luck.
- No dedicated trade history page exists anywhere in the app.

## Proposed Solution

### Portfolio enhancements

- **Resolved section**: Add a "Cost" column (`avgCostBasis × shares`) and a "Net P&L"
  column (`payout - cost`). Color net P&L green/red. Keep "Payout" column.
- **Cancelled markets**: Filter out cancelled-market positions from the active-positions
  table. Add a small "Cancelled" section (or simply exclude them — they are already
  refunded via `coinTransactions`). Positions on cancelled markets have `shares > 0` but
  `market.status = 'cancelled'`; they should not show a misleading LMSR value.
- **Trade history**: Remove the 20-trade "Trade History" section at the bottom of
  Portfolio (or replace it with a "View full history →" link to `/history`).

### Leaderboard: win rate column

Add a third query for resolved-market win statistics per user:

```ts
// Drizzle:
const winStats = await db
  .select({
    userId: positions.userId,
    wins: sql<number>`count(*) filter (where ${positions.outcome} = ${markets.outcome})`,
    total: sql<number>`count(*)`,
  })
  .from(positions)
  .innerJoin(
    markets,
    and(eq(positions.marketId, markets.id), eq(markets.status, "resolved"))
  )
  .where(and(gt(positions.shares, "0"), inArray(positions.userId, topUserIds)))
  .groupBy(positions.userId);
```

Compute `winRate = wins / total` per user. Display as `"X/Y (Z%)"` or just `"Z%"` in a
new "Win Rate" column. Show `"—"` for users with no resolved positions.

### History page (`src/app/history/page.tsx`)

New auth-gated server component. Queries:

```ts
const allTrades = await db
  .select({
    trade: trades,
    market: { id: markets.id, title: markets.title },
  })
  .from(trades)
  .innerJoin(markets, eq(trades.marketId, markets.id))
  .where(eq(trades.userId, userId))
  .orderBy(desc(trades.createdAt))
  .limit(500);
```

Table columns: Date, Market (linked), Side (BUY/SELL badge), YES/NO, Shares, Cost (coins),
Price Before → After (optional, keep it simple).

Add a "History" link to `Navbar.tsx` for signed-in users (alongside Portfolio and
Leaderboard).

## Technical Considerations

- **`positions.outcome` vs `markets.outcome` type**: Both are `integer`. In the win-rate
  SQL, `positions.outcome = markets.outcome` compares integers directly — no casting needed.
- **`positions.shares > '0'`**: The column is `decimal` stored as string in Drizzle ORM;
  use `gt(positions.shares, "0")` for the Drizzle `where` clause.
- **LMSR value for cancelled positions**: These positions have real quantities but
  `market.status = 'cancelled'`. Filter them out of the active-positions map in Portfolio
  (`activePositions` currently includes `active | halted | resolving` — just exclude
  `cancelled` which is not in that list already. However the `openPositions` query uses
  `ne(positions.shares, "0")` with no status filter, so resolved AND cancelled positions
  both appear in `openPositions`. The resolved section filters for `status === 'resolved'`.
  Cancelled positions fall through neither branch and are silently ignored — confirm this
  or add explicit filtering to make the intent clear.
- **No new DB tables or migrations needed**.
- **Import `gt` from `drizzle-orm`** in the leaderboard page (currently uses `and`, `desc`,
  `eq`, `inArray`, `ne` — add `gt` and `sql`).
- **Pagination for History**: 500-row limit is sufficient for MVP. If needed, pagination can
  be added later; don't add it now (YAGNI).

## System-Wide Impact

- **Interaction graph:** All three pages are read-only server components with no mutations.
  No callbacks, middleware, or observers fire. Risk is minimal.
- **Error propagation:** DB query failures bubble to Next.js error boundary (existing
  behavior). No new error paths.
- **State lifecycle risks:** None — purely additive queries.
- **API surface parity:** No API routes are involved; all data-fetching is server-side.

## Acceptance Criteria

- [ ] Portfolio resolved section shows "Cost", "Payout", and "Net P&L" columns; net P&L is
      green for profit, red for loss
- [ ] Cancelled-market positions do not appear in the active-positions section
- [ ] Portfolio's 20-trade list at the bottom is replaced by a "View full history →" link
- [ ] Leaderboard has a "Win Rate" column; users with no resolved positions show "—"
- [ ] `/history` page exists, is auth-gated, and lists all user trades ordered newest-first
- [ ] History rows include: date, market link, BUY/SELL badge, YES/NO, shares, cost
- [ ] "History" link appears in Navbar for signed-in users
- [ ] No TypeScript build errors
- [ ] All pages match the existing Tailwind card/table/badge styling

## Implementation Steps

### Step 1 — Update `src/app/portfolio/page.tsx`

1. Tighten the status filters:
   - `activePositions`: status in `['active', 'halted', 'resolving']` — unchanged (cancelled
     is already excluded, but add a comment).
   - `resolvedPositions`: status `=== 'resolved'` — unchanged.
   - Optionally add a `cancelledPositions` variable if you want to surface a message;
     otherwise leave as silent (they are already refunded, showing nothing is correct).

2. In the resolved-positions table, add columns:
   - `Cost` = `parseFloat(p.position.avgCostBasis) * shares`
   - `Net P&L` = `payout - cost`, colored green/red

3. Replace the "Trade History" section (`recentTrades` query + table) with:
   ```tsx
   <section>
     <div className="flex items-center justify-between mb-3">
       <h2 className="text-lg font-semibold">Recent Trades</h2>
       <Link href="/history" className="text-sm text-accent hover:underline">
         View all →
       </Link>
     </div>
     {/* keep existing 5-10 trade preview, or just the link */}
   </section>
   ```
   Keep the existing mini-list at 5 rows (reduce from 20), since the full history lives at
   `/history`.

### Step 2 — Update `src/app/leaderboard/page.tsx`

1. Add imports: `gt`, `sql` from `drizzle-orm`.
2. After fetching `allPositions`, add the win-stats query (only if `topUserIds.length > 0`).
3. Build a `winStatsByUser = new Map<string, { wins: number; total: number }>()`.
4. In the `ranked.map()`, attach `winRate` to each user.
5. Add a "Win Rate" `<th>` and `<td>` to the table. Format as `"W/T (X%)"` where W=wins,
   T=total, X=percentage — or just `"X%"` for simplicity.

### Step 3 — Create `src/app/history/page.tsx`

New file. Pattern follows portfolio page:
- `auth()` → redirect if not logged in
- Query all trades for userId joined with markets, limit 500, order DESC
- Table with columns: Date/Time, Market, Side, YES/NO, Shares, Cost
- Empty state: "No trades yet. Browse markets to start trading."
- Use same `bg-card border border-border rounded-xl overflow-hidden` table wrapper.

### Step 4 — Update `src/components/Navbar.tsx`

Add `<Link href="/history" ...>History</Link>` inside the `{session?.user && (...)}` block,
after the Leaderboard link.

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| Win-rate query uses `FILTER` aggregate — Postgres-only | Already on Postgres (Neon) — fine |
| Large trade counts in History (>500 rows) | 500-row limit is MVP; pagination deferred |
| `avgCostBasis * shares` for resolved cost may be slightly off if user sold partial | Acceptable for display; cost = avgCostBasis × remaining shares at resolution time |

## Sources & References

- Portfolio to update: `src/app/portfolio/page.tsx`
- Leaderboard to update: `src/app/leaderboard/page.tsx`
- History page to create: `src/app/history/page.tsx`
- Navbar to update: `src/components/Navbar.tsx`
- Schema: `src/db/schema.ts` — `positions`, `trades`, `markets`, `users`
- LMSR utils: `src/lib/lmsr.ts` — `price()`, `allPrices()`
- Market utils: `src/lib/market-utils.ts` — `getMarketPrices()`
- Existing Drizzle patterns: `src/app/leaderboard/page.tsx:23` (two-query pattern for top-N)
