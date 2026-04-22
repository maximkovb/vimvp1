---
title: "feat: Resolved Markets Separate Page"
type: feat
status: completed
date: 2026-04-08
origin: docs/brainstorms/2026-04-08-resolved-markets-separate-page-requirements.md
---

# feat: Resolved Markets Separate Page

## Overview

Resolved prediction markets currently appear mixed with active markets in the home page end-of-feed grid ("All Markets"). This change separates them: the home grid shows only active/halted/resolving markets, and a new public `/resolved` page shows all resolved markets. A "View resolved markets →" link at the bottom of the home grid bridges the two.

## Problem Statement / Motivation

Users browsing the home page end grid cannot distinguish markets they can still bet on from markets that have already settled. The "All Markets" label is inaccurate once resolved markets are included. Separating them keeps the home page focused on actionable content and gives resolved markets a dedicated browsing surface.

(see origin: docs/brainstorms/2026-04-08-resolved-markets-separate-page-requirements.md)

## Proposed Solution

Four targeted changes across three files, plus one new file:

1. **`src/app/page.tsx`** — Remove the resolved markets query and stop passing resolved markets to `DiscoverFeed`.
2. **`src/components/FeedEndGrid.tsx`** — Rename heading, add link to `/resolved`.
3. **`src/app/resolved/page.tsx`** _(new)_ — Public Server Component: queries resolved markets, renders a grid of `MarketCard` components.
4. **`src/app/resolved/loading.tsx`** _(new)_ — Co-located loading skeleton matching the card grid shape.

## Technical Considerations

### BigInt serialization across RSC boundary

`milestoneThreshold` is a `bigint` column. The home page already passes `bigint` values from the Server Component to `DiscoverFeed` (a client component), and this works because React's RSC wire format supports `BigInt` natively. The `/resolved` page follows the same pattern — no explicit serialization step needed.

### `resolvedAt` ordering and null handling

`resolvedAt` is nullable. `ORDER BY resolvedAt DESC` in Postgres sorts NULLs first by default (nulls sort high in descending order), which would float broken rows to the top. The query must use `desc(markets.resolvedAt).nullsLast()` — or raw SQL `ORDER BY resolved_at DESC NULLS LAST`.

> **Note:** Drizzle's `desc()` helper does not support `.nullsLast()` as a chainable method in all versions. Use `sql\`resolved_at DESC NULLS LAST\`` as a fallback if the helper isn't available. Check the installed version's docs before writing this query (per AGENTS.md: read `node_modules/next/dist/docs/` for Next.js; apply same discipline to Drizzle).

### Timestamp display

`resolvedAt` is not displayed on `MarketCard` in the grid — no timestamp rendering is needed at launch. If a "Resolved X days ago" label is added later, use `new Date(row.resolvedAt)` safely (Drizzle with `mode: "date"` parses Neon timestamps correctly for ORM queries, unlike raw SQL results).

### Database index

An index `markets_status_idx` already exists on `status`. The resolved page query (`WHERE status = 'resolved' ORDER BY resolved_at DESC NULLS LAST`) will filter efficiently using this index. A composite `(status, resolved_at)` index is not required at current scale but is worth adding if query time grows.

### Query limit

The resolved market count grows indefinitely. Use `.limit(50)` for the `/resolved` page. No pagination at launch.

## System-Wide Impact

- **Home page data fetch**: The `resolvedMarkets` query is removed from `page.tsx` entirely — it was only used to populate `gridMarkets`. This eliminates one DB round-trip on every home page load.
- **FeedEndGrid**: Receives `gridMarkets` that no longer includes resolved markets. The component's empty-state guard (`gridMarkets.length === 0 → return null`) remains correct — if there are zero active/halted/resolving markets, the grid and its "View resolved markets →" link both disappear. This is an acceptable edge case.
- **`GET /api/markets`**: Returns `{ active: [...], resolved: [...] }` and is unaffected by this change — it has its own query.
- **Cancelled/failed markets**: Not shown on the home grid or `/resolved` page. No change to existing behavior.

## Acceptance Criteria

- [ ] **R1.** The home page end-of-feed grid (`FeedEndGrid`) renders only markets with status `active`, `halted`, or `resolving`. No resolved markets appear.
- [ ] **R2.** The `FeedEndGrid` heading reads "Active Markets" (not "All Markets").
- [ ] **R3.** A "View resolved markets →" link appears at the bottom of the home page end grid, navigating to `/resolved`.
- [ ] **R4.** `GET /resolved` returns a page displaying resolved markets in a `grid grid-cols-2 sm:grid-cols-3` layout using `MarketCard`, ordered by `resolvedAt DESC NULLS LAST`, limited to 50 results.
- [ ] **R5.** `/resolved` is publicly accessible — no authentication required, no redirect to sign-in.
- [ ] The home page no longer issues the resolved markets DB query.
- [ ] `MarketCard` outcome rendering (YES/NO badge) works correctly on the `/resolved` page.
- [ ] `/resolved` renders a loading skeleton while data is fetched.

## Implementation

### File: `src/app/page.tsx`

Remove the `resolvedMarkets` query from the `Promise.all` call and remove `resolvedMarkets` from the `gridMarkets` assembly.

```ts
// Before (lines 8–27):
const [activeMarkets, resolvedMarkets] = await Promise.all([
  db.select().from(markets).where(or(...)).orderBy(desc(markets.createdAt)).limit(50),
  db.select().from(markets).where(eq(markets.status, "resolved")).orderBy(desc(markets.resolvedAt)).limit(12),
]);
// ...
const gridMarkets = [...activeMarkets, ...resolvedMarkets]; // line 61

// After:
const activeMarkets = await db
  .select()
  .from(markets)
  .where(or(eq(markets.status, "active"), eq(markets.status, "halted"), eq(markets.status, "resolving")))
  .orderBy(desc(markets.createdAt))
  .limit(50);
// ...
const gridMarkets = [...resolvingSoon, ...mainMarkets]; // already filtered above
```

> The `Promise.all` wrapper can be removed since only one query remains, or kept if other parallel queries are added later. Either is fine.

### File: `src/components/FeedEndGrid.tsx`

Two changes:
1. Update the heading text.
2. Add a `Link` after the grid.

```tsx
// src/components/FeedEndGrid.tsx
import Link from "next/link";

// Change heading (line 37):
// Before: <h2 className="text-lg font-semibold mb-4 text-foreground">All Markets</h2>
// After:
<h2 className="text-lg font-semibold mb-4 text-foreground">Active Markets</h2>

// Add after the closing </div> of the grid (after line 51):
<div className="mt-4 text-center">
  <Link href="/resolved" className="text-sm text-accent hover:underline">
    View resolved markets →
  </Link>
</div>
```

### File: `src/app/resolved/page.tsx` _(new)_

Public async Server Component. Follows the leaderboard pattern (`max-w-Xwl mx-auto px-4 py-6`, no auth).

```tsx
// src/app/resolved/page.tsx
import { db } from "@/db";
import { markets } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { MarketCard } from "@/components/MarketCard";
import { getMarketPrices } from "@/lib/market-utils";

export default async function ResolvedMarketsPage() {
  const resolvedMarkets = await db
    .select()
    .from(markets)
    .where(eq(markets.status, "resolved"))
    .orderBy(sql`resolved_at DESC NULLS LAST`)
    .limit(50);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-6">Resolved Markets</h1>

      {resolvedMarkets.length === 0 ? (
        <p className="text-sm text-muted">No resolved markets yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {resolvedMarkets.map((market) => {
            const prices = getMarketPrices(market);
            return (
              <MarketCard
                key={market.id}
                id={market.id}
                title={market.title}
                status={market.status}
                questionType={market.questionType}
                milestoneThreshold={market.milestoneThreshold}
                priceYes={prices[0]}
                priceNo={prices[1]}
                resolvesAt={market.resolvesAt}
                outcome={market.outcome}
                videoMetadata={market.videoMetadata}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
```

### File: `src/app/resolved/loading.tsx` _(new)_

Skeleton matching the 2-column card grid shape. Model on `src/app/loading.tsx`.

```tsx
// src/app/resolved/loading.tsx
export default function Loading() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="h-8 w-48 bg-muted/30 rounded mb-6 animate-pulse" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-muted/20 animate-pulse">
            <div className="aspect-video rounded-t-xl bg-muted/30" />
            <div className="p-2 space-y-2">
              <div className="h-3 bg-muted/30 rounded w-3/4" />
              <div className="h-3 bg-muted/30 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Dependencies & Risks

- **`desc().nullsLast()` Drizzle support** — If the installed Drizzle version doesn't support chained `.nullsLast()`, fall back to raw `sql\`resolved_at DESC NULLS LAST\``. Verify before implementation. Risk: low (easy fallback).
- **`MarketCard` client/server status** — If `MarketCard` is a Client Component, RSC payload serializes `bigint` props correctly (Next.js 13+). If future Next.js upgrades break this, serialize `milestoneThreshold` to string at the page level. Risk: low (existing home page already crosses this boundary successfully).

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-08-resolved-markets-separate-page-requirements.md](../brainstorms/2026-04-08-resolved-markets-separate-page-requirements.md)
  - Key decisions carried forward: (1) separate page over same-page split, (2) link in end grid over nav bar addition, (3) no auth required on `/resolved`
- Home page data fetch: `src/app/page.tsx:8–27, 61`
- FeedEndGrid component: `src/components/FeedEndGrid.tsx:32–60`
- MarketCard component: `src/components/MarketCard.tsx:8–23`
- Market price utility: `src/lib/market-utils.ts:43–54`
- Schema (markets table, status field): `src/db/schema.ts:89–125`
- Public page reference (leaderboard): `src/app/leaderboard/page.tsx`
- Loading skeleton reference: `src/app/loading.tsx`
- Learnings — timestamp UTC gotcha: `docs/solutions/logic-errors/neon-timestamp-utc-offset-cron-cooldown-null-poll-guard.md`
- Learnings — status filter precision: `docs/solutions/logic-errors/tiktok-market-resolution-race-condition.md`
