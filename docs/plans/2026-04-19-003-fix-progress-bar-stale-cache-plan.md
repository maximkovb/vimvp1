---
title: "fix: Progress Bar Stale After Poll — Missing Cache Layers"
type: fix
status: active
date: 2026-04-19
---

# fix: Progress Bar Stale After Poll — Missing Cache Layers

## Overview

The milestone progress bar on the feed page never updates its view/like count after the initial page load, requiring a manual page refresh to see new poll data. The root cause is the three-layer Next.js 16.2.1 cache bug documented in `docs/solutions/runtime-errors/nextjs-swr-three-layer-cache-stale.md`: `/api/feed/polls` is missing Layer 2 (`Cache-Control: no-store`), so every SWR poll gets a cached response regardless of the freshly-executed DB query. A secondary issue: `marketFetcher` is missing Layer 3 (`cache: "no-store"`), causing the same stale-data symptom for all market detail live data.

## Problem Frame

`DiscoverFeed` subscribes to `/api/feed/polls` via SWR every 60 seconds. The route handler runs a fresh DB query on each request (`DISTINCT ON market_id ORDER BY polled_at DESC`), but without `Cache-Control: no-store` in the response, the browser's HTTP cache (or a CDN layer) replays the first response on all subsequent fetches. From SWR's perspective the request "succeeds" (HTTP 200, real byte count) but the response body never changes — so `currentCount` never changes, and `ProgressBar.fillPct` is frozen at page-load value.

The same pattern affects `/api/markets/[id]` via `marketFetcher`, which fetches without `{ cache: "no-store" }` (Layer 3), allowing the browser's fetch-level cache to serve stale market data to `MarketLiveData` and `LiveEngagementStats`.

## Requirements Trace

- R1. After a TikTok cron poll updates the DB, the feed's milestone progress bar must reflect the new count within the next SWR interval (~60 s), without a manual page refresh.
- R2. Live market data on the detail page (view counts, price history, recent trades) must also update each SWR interval without a manual refresh.
- R3. All live-data API routes must satisfy the three-layer checklist (Layer 1: `force-dynamic`, Layer 2: `Cache-Control: no-store`, Layer 3: `cache: "no-store"` in fetcher).

## Scope Boundaries

- No change to polling frequency (cron stays at `*/10`, SWR stays at 60 s).
- No WebSocket or SSE real-time push — the existing SWR polling model is sufficient once caching is fixed.
- Does not address `BalanceChip.tsx` or `balance/route.ts` regressions (separate, lower priority).

## Context & Research

### Relevant Code and Patterns

- `src/app/api/markets/[id]/route.ts:122` — already returns `{ headers: { "Cache-Control": "no-store" } }`. This is the template to replicate in the polls route.
- `src/app/api/feed/polls/route.ts` — has `force-dynamic` (Layer 1 ✓) but returns `NextResponse.json(polls)` with no headers (Layer 2 ✗).
- `src/lib/market-fetcher.ts` — `fetch(url)` with no `{ cache: "no-store" }` (Layer 3 ✗). `pollFetcher` in `DiscoverFeed.tsx` already uses `fetch(url, { cache: "no-store" })` — the pattern to follow.
- `src/hooks/useMarketData.ts` — canonical hook with stable `useCallback` `refreshInterval`. `MarketLiveData` and `LiveEngagementStats` have their own inline `useSWR` calls that duplicate config and use inline `refreshInterval` functions (known timer-reset anti-pattern; comment in `useMarketData.ts` explains why).

### Institutional Learnings

- `docs/solutions/runtime-errors/nextjs-swr-three-layer-cache-stale.md` — complete diagnosis and prevention checklist for the three-layer cache bug. The regression table (as of 2026-04-13) explicitly lists `src/app/api/feed/polls/route.ts` as missing Layer 2 and `src/components/BalanceChip.tsx` as missing Layer 3.

## Key Technical Decisions

- **Fix in the route handler, not via middleware**: Layer 2 is best added directly in `NextResponse.json(payload, { headers })` at the call site. This keeps the fix co-located with the data and matches the existing pattern in `markets/[id]/route.ts`.
- **Fix `marketFetcher` as a shared module**: All consumers (`MarketHUD` via `useMarketData`, `MarketLiveData`, `LiveEngagementStats`) inherit Layer 3 from a single change. No per-component patches needed.
- **Migrate `MarketLiveData` and `LiveEngagementStats` to `useMarketData`**: Eliminates the inline `refreshInterval` anti-pattern and reduces SWR config duplication. The `useMarketData` hook already exists for exactly this purpose.

## Open Questions

### Resolved During Planning

- **Is the market detail route missing Layer 2?** No — `src/app/api/markets/[id]/route.ts:122` already includes `Cache-Control: no-store`.
- **Is the feed polls route missing Layer 3?** No — `pollFetcher` in `DiscoverFeed.tsx` uses `fetch(url, { cache: "no-store" })`. Only Layer 2 is missing on this route.
- **Does the inline refreshInterval in `MarketLiveData` block updates despite shared SWR key?** Not completely — `MarketHUD` via `useMarketData` (with stable `useCallback`) still fires the interval and updates the shared SWR cache, so all subscribers receive the data. However, the inline function means `MarketLiveData`'s own timer resets on every render, making it entirely dependent on `MarketHUD`'s subscription being present. Migration to `useMarketData` removes this fragile coupling.

### Deferred to Implementation

- Whether any CDN (Vercel Edge Network) caches these routes in production — implementation should verify via response headers in DevTools after the fix.

## Implementation Units

- [ ] **Unit 1: Fix Layer 2 on `/api/feed/polls`**

**Goal:** Add `Cache-Control: no-store` to the polls route response so the browser and any CDN do not cache the view/like counts.

**Requirements:** R1, R3

**Dependencies:** None

**Files:**
- Modify: `src/app/api/feed/polls/route.ts`

**Approach:**
- Extract the `polls` array into a named variable before returning, then pass it as the first argument to `NextResponse.json` with `{ headers: { "Cache-Control": "no-store" } }` as the second argument.
- Pattern to follow: `src/app/api/markets/[id]/route.ts:122`.

**Patterns to follow:**
- `src/app/api/markets/[id]/route.ts` — `return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } })`

**Test scenarios:**
- Happy path: After the fix, open DevTools Network tab, navigate to the feed, filter to `/api/feed/polls`. The response header must show `cache-control: no-store`. On the second SWR poll (~60 s later), the response body must differ if poll data changed in the DB. Size column must show a real byte count (not `from disk cache`).
- Edge case: If no active markets exist, the route returns `[]` — confirm the empty response also includes the header.
- Integration: Update a `tiktok_polls` row in the DB directly, wait for the next SWR interval, confirm the progress bar on the feed reflects the new count without a page refresh.

**Verification:**
- DevTools Network: `cache-control: no-store` present in response headers for `/api/feed/polls`.
- Progress bar on the feed updates its fill percentage within 60 s of a DB poll record being inserted, without manual page refresh.

---

- [ ] **Unit 2: Fix Layer 3 in `marketFetcher`**

**Goal:** Add `{ cache: "no-store" }` to the fetch call in `marketFetcher` so the browser's internal fetch cache does not serve stale market data.

**Requirements:** R2, R3

**Dependencies:** None

**Files:**
- Modify: `src/lib/market-fetcher.ts`

**Approach:**
- Add `{ cache: "no-store" }` as the second argument to the `fetch(url, ...)` call. One-line change.
- Pattern to follow: `pollFetcher` in `src/components/DiscoverFeed.tsx` — `fetch(url, { cache: "no-store" })`.

**Patterns to follow:**
- `src/components/DiscoverFeed.tsx` — `pollFetcher` — `const res = await fetch(url, { cache: "no-store" })`

**Test scenarios:**
- Happy path: In DevTools, filter Network to `/api/markets/<id>`. Confirm `cache-control: no-store` is present in the response (it already is from Unit 1 of the prior fix on that route). Confirm on the second SWR poll (~60 s) the response body reflects DB state.
- Integration: On the market detail page, insert a new `tiktok_polls` row in the DB; confirm `LiveEngagementStats` view/like numbers update within ~60 s without a page refresh.

**Verification:**
- Market detail page live data (views, likes, prices, trades) visually updates every ~60 s without a manual refresh.

---

- [ ] **Unit 3: Migrate `MarketLiveData` and `LiveEngagementStats` to `useMarketData`**

**Goal:** Replace each component's inline `useSWR` call (with its unstable inline `refreshInterval` function) with the shared `useMarketData` hook to eliminate the timer-reset anti-pattern and reduce SWR config duplication.

**Requirements:** R2

**Dependencies:** Unit 2 (so the hook's underlying fetcher is already fixed when migration lands)

**Files:**
- Modify: `src/components/MarketLiveData.tsx`
- Modify: `src/components/LiveEngagementStats.tsx`

**Approach:**
- In `MarketLiveData`: replace `useSWR<MarketData>(...)` call with `useMarketData(marketId, initialData)`. Remove the now-unused `useSWR` import if no other `useSWR` call remains. The `data` and `isValidating` destructuring stays the same.
- In `LiveEngagementStats`: same replacement. The component only reads `data`, so only destructure `{ data }` from `useMarketData`.
- Both components already receive `marketId` and `initialData` props matching `useMarketData`'s signature.
- `useMarketData` already uses `useCallback` for the adaptive `refreshInterval`, so the timer-reset risk is eliminated by the hook itself.

**Patterns to follow:**
- `src/components/MarketHUD.tsx` — `const { data, mutate, isValidating } = useMarketData(marketId, initialData)` — canonical usage of the hook.

**Test scenarios:**
- Happy path: Market detail page renders with correct initial data (SSR fast path preserved via `fallbackData`).
- Happy path: After ~60 s, `LiveEngagementStats` view/like numbers update to match a new `tiktok_polls` row.
- Happy path: After ~60 s, `VideoStatsChart` inside `MarketLiveData` receives updated `statsChartData` and the chart extends to include the new data point.
- Edge case: When market status transitions to `halted` via a live update, confirm `MarketLiveData`'s `VideoStatsChart` continues rendering (the chart should not unmount/remount on a status change that doesn't affect `milestone` or `metricLabel`).
- Integration: `MarketHUD`, `MarketLiveData`, and `LiveEngagementStats` all subscribe to the same SWR key `/api/markets/<id>` — confirm only one network request fires per poll interval (SWR deduplication), not three.

**Verification:**
- DevTools Network: single request to `/api/markets/<id>` per 60 s interval (not three).
- View count in `LiveEngagementStats` updates within ~60 s of a new poll row being inserted, without page refresh.
- `VideoStatsChart` chart line extends with a new data point each poll interval.

## System-Wide Impact

- **Interaction graph:** Unit 3 touches all three SWR subscribers on the market detail page. `MarketHUD`'s `mutate()` call (used post-trade) is not affected — it targets the same SWR key and remains valid.
- **Unchanged invariants:** SWR `fallbackData: initialData` is preserved in `useMarketData`, so SSR hydration remains instant. The `refreshInterval` adaptive logic (10 s for halted/resolving, 60 s otherwise) is already in `useMarketData` — no behavior change.
- **Error propagation:** No new error paths. `useMarketData` propagates errors the same way `useSWR` does.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| CDN (Vercel Edge) ignores `Cache-Control: no-store` | Verify in production DevTools after deploy; add `s-maxage=0` if needed |
| `useMarketData` in `LiveEngagementStats` removes `revalidateOnFocus: false` (not present in hook) | `useMarketData` sets `revalidateOnFocus: true`. This is correct for the detail page. The feed polls route (`DiscoverFeed`) retains its own `revalidateOnFocus: false` and is unaffected. |

## Sources & References

- **Institutional learning:** `docs/solutions/runtime-errors/nextjs-swr-three-layer-cache-stale.md` — full three-layer diagnosis, prevention checklist, and regression table
- Related code: `src/app/api/markets/[id]/route.ts:122` — Layer 2 pattern
- Related code: `src/components/DiscoverFeed.tsx` — `pollFetcher` — Layer 3 pattern
- Related code: `src/hooks/useMarketData.ts` — stable hook pattern
