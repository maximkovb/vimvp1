---
title: Next.js SWR Three-Layer Cache — Stale Live Data
date: 2026-04-13
last_updated: 2026-04-19
category: runtime-errors
tags: [nextjs, caching, swr, live-data, force-dynamic, cache-control, fetch-cache, app-router, stale-data, polling]
problem_type: runtime-errors
components:
  - src/components/DiscoverFeed.tsx
  - src/components/MarketLiveData.tsx
  - src/components/MarketHUD.tsx
  - src/components/LiveEngagementStats.tsx
  - src/app/api/markets/[id]/route.ts
  - src/app/api/feed/polls/route.ts
  - src/lib/market-fetcher.ts
  - src/hooks/useMarketData.ts
symptoms:
  - Views, likes, and progress ring metrics never update after market creation
  - SWR refreshInterval fires correctly but UI always shows server-render-time values
  - No errors in console or network failures — fetches succeed but return stale data
  - Fixing one caching layer appears to have no effect; symptom is identical at every partial-fix stage
---

# Next.js SWR Three-Layer Cache — Stale Live Data

## Problem

After market creation in the virality app, all live metrics (views, likes, progress ring) were permanently frozen at their server-render-time values despite SWR being configured with a `refreshInterval`. SWR was firing requests on schedule, network calls returned HTTP 200 — everything appeared functional. The real cause was Next.js 16.2.1 silently caching at three independent, orthogonal layers: the route-level ISR-style cache (Layer 1), the HTTP response cache (Layer 2), and the browser fetch cache (Layer 3). Fixing any one or two layers was insufficient — cached responses leaked through whichever layer remained unfixed, making partial fixes appear to have no effect and obscuring which layer was still responsible. A secondary compounding issue was that `DiscoverFeed` had no live-refresh path at all: poll data arrived only as a static server-rendered prop, requiring a new `/api/feed/polls` endpoint and SWR subscription to be added before live updates could work end-to-end.

---

## Root Cause

Next.js 16.2.1 has three independent caching layers that all silently intercept responses. The bug presents identically whether layer 1, 2, or 3 is the culprit — there is no visible error, the fetch just returns stale data.

**Layer 1 — Next.js route cache (ISR-style):**
API routes are cached server-side by default in App Router. Even when the handler runs a fresh DB query, Next.js may serve a cached response from a previous execution. This operates before your route handler runs, so it cannot be fixed by anything inside the handler.

**Layer 2 — HTTP response cache:**
The browser caches responses using standard HTTP semantics. Without an explicit `Cache-Control: no-store` header, even a freshly-executed response can be stored and replayed on subsequent requests.

**Layer 3 — Browser fetch cache:**
`fetch()` in client components has its own internal cache mode (separate from the HTTP cache visible in DevTools). Without `{ cache: "no-store" }`, the browser may return a stale entry regardless of what response headers say. This is the most deceptive layer — the request appears to succeed in the Network tab but the response body is stale.

> **Rule from auto memory ([claude]):** All three layers must be fixed simultaneously. Fixing one or two is not enough.

---

## Solution

### Fix 1 — Disable Next.js route cache

Add `force-dynamic` to every API route that serves live data:

```typescript
// src/app/api/markets/[id]/route.ts
// src/app/api/feed/polls/route.ts
export const dynamic = "force-dynamic";
```

### Fix 2 — Set HTTP response cache header

Return `Cache-Control: no-store` on every live data response. Extract the payload first to avoid syntax issues:

```typescript
const payload = { ...marketData };
return NextResponse.json(payload, {
  headers: { "Cache-Control": "no-store" },
});
```

### Fix 3 — Disable browser fetch cache

Pass `{ cache: "no-store" }` in every SWR fetcher function. The shared fetcher in `market-fetcher.ts` is the correct place for this — all SWR subscriptions that import it inherit the fix:

```typescript
// src/lib/market-fetcher.ts
export async function marketFetcher(url: string): Promise<MarketData> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch market data: ${res.status}`);
  return res.json();
}
```

### Fix 4 — Feed live updates: server-rendered prop has no update path

`DiscoverFeed` received poll data only as a static server-rendered prop. Added `/api/feed/polls` endpoint and a SWR subscription:

```typescript
// src/components/DiscoverFeed.tsx
const { data: livePollData } = useSWR<PollData[]>(
  "/api/feed/polls",
  pollFetcher, // also uses { cache: "no-store" }
  { refreshInterval: 60_000, fallbackData: pollData, revalidateOnFocus: false }
);
// use livePollData ?? pollData in render
```

### Fix 5 — Shared `useMarketData` hook

`MarketLiveData`, `MarketHUD`, and `LiveEngagementStats` each had duplicate SWR config. Consolidated into a single hook with adaptive refresh interval:

```typescript
// src/hooks/useMarketData.ts
export function useMarketData(marketId: string, initialData: MarketData) {
  return useSWR<MarketData>(
    `/api/markets/${marketId}`,
    marketFetcher,
    {
      refreshInterval: (latestData) => {
        const status = latestData?.status ?? initialData.status;
        return status === "halted" || status === "resolving" ? 10_000 : 60_000;
      },
      fallbackData: initialData,
      revalidateOnMount: true,
      revalidateOnFocus: true,
    }
  );
}
```

---

## Investigation Notes

**Why this was hard to diagnose:**

- The failure mode is silent. SWR fires its fetcher, the fetch returns HTTP 200, the data looks valid — it is just stale. No errors, no warnings.
- Each caching layer acts as an independent failure point. After fixing one layer, the symptom (stale data) is identical, so the fix appears to have had no effect. Easy to abandon a correct fix.
- Next.js route caching may behave differently locally (lighter caching in dev mode) vs. production, masking the bug during development.
- The browser fetch cache is separate from the HTTP cache visible in DevTools' Network tab. A request that shows "200 OK" with a real byte count may still be returning a browser fetch-cached response — it does not always show as "(from cache)" the way HTTP cache entries do.
- `refreshInterval` working with no effect is a particularly deceptive failure because the SWR configuration itself is correct; the problem is entirely outside SWR's control.

**Dead ends likely tried:**
- Increasing `refreshInterval` — has no effect when the fetch itself returns cached data
- Adjusting `revalidateOnFocus` / `revalidateOnMount` — correct values but irrelevant to the root cause
- Verifying the DB query returns fresh data in the handler — it does, but the response is cached before it leaves the server

---

## Prevention

### Checklist for New Live-Data API Routes

Before shipping any route that must serve real-time data:

**Layer 1 — Route cache**
- [ ] `export const dynamic = "force-dynamic"` at the top of the route file
- [ ] No `export const revalidate = <number>` re-enabling ISR
- [ ] No `unstable_cache` wrapping the data-fetch logic

**Layer 2 — HTTP response cache**
- [ ] Response includes `Cache-Control: no-store` in `NextResponse` constructor
- [ ] Use `no-store`, not `no-cache` (`no-cache` still stores — just revalidates)

**Layer 3 — Browser fetch cache**
- [ ] Every `fetch()` to a live endpoint passes `{ cache: "no-store" }`
- [ ] SWR fetcher functions pass this option — SWR does not bypass the browser fetch cache on its own

**Serialization**
- [ ] No `bigint` values in JSON responses — convert to `number` or `string` at the API boundary

### Code Review Trigger

> For any route under `app/api/` that reads from a database or external API: verify `dynamic = "force-dynamic"`, `Cache-Control: no-store`, and `fetch({ cache: "no-store" })` are all present. A single missing layer silently serves stale data with no error.

### How to Verify the Fix in DevTools

1. Filter Network tab to your API route
2. Size column: a real byte count (e.g. `432 B`) means a live response; `(from disk cache)` or `(from memory cache)` means a cache hit
3. Response Headers: confirm `cache-control: no-store` is present in the **response** (not just request)
4. Time column: ~0ms on consecutive requests signals a cache hit; real round-trips show 40–200ms+
5. Mutate the underlying data, wait one SWR interval, confirm the response body changed — this is the definitive test

---

## Known Regressions (Routes Still Missing the Fix)

As of 2026-04-13, these routes serve live data but are missing one or more layers:

| Route | Missing |
|---|---|
| `src/app/api/balance/route.ts` | Layer 1, 2 |
| `src/app/api/portfolio/route.ts` | Layer 1, 2 |
| `src/app/api/markets/route.ts` | Layer 1, 2 |
| `src/app/api/tiktok/[videoId]/play-url/route.ts` | Layer 1, 2 |
| `src/app/api/feed/polls/route.ts` | ~~Layer 2~~ ✅ resolved (2026-04-19) |
| `src/lib/market-fetcher.ts` | ~~Layer 3~~ ✅ resolved (2026-04-19) |
| `src/components/BetSheet.tsx` fetcher | ~~Layer 3~~ ✅ resolved (2026-04-16, todo 112) |
| `src/components/BalanceChip.tsx` fetcher | Layer 3 |

**2026-04-19 update:** The milestone progress bar stale-data regression was resolved in this batch:
- `src/app/api/feed/polls/route.ts` — added `Cache-Control: no-store` to both response paths (Layer 2). This was the root cause of the feed progress bar freezing at page-load values.
- `src/lib/market-fetcher.ts` — added `{ cache: "no-store" }` to `fetch()` call (Layer 3). All SWR subscribers that import this fetcher (`MarketHUD` via `useMarketData`, `MarketLiveData`, `LiveEngagementStats`) inherit the fix.
- `src/components/MarketLiveData.tsx` and `src/components/LiveEngagementStats.tsx` — migrated from inline `useSWR` with unstable inline `refreshInterval` functions to the shared `useMarketData` hook. The inline pattern caused the SWR timer to reset on every render (see comment in `useMarketData.ts`), though the effect was partially masked by `MarketHUD`'s correct subscription. Migration eliminates fragile coupling and reduces SWR config duplication.

---

## Common Pitfalls

**Why 1–2 layers isn't enough:** Each layer independently short-circuits the chain. Fixing upstream layers does not fix downstream ones. The symptom in all partial-fix cases is identical stale data with no error.

**Next.js 16 vs. Pages Router:** App Router routes are static by default — you must opt out of caching. Pages Router `getServerSideProps` was dynamic by default. Next.js also patches `fetch()` to use `force-cache` by default in App Router, which is the opposite of the browser's historical default. All three defaults compound into cache-on.

**`bigint` JSON trap:** Database drivers (Postgres, MySQL) return `bigint` columns as JavaScript `bigint` primitives. `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt`. Convert to `number` at the API boundary (safe if values are below `Number.MAX_SAFE_INTEGER`).

---

## Related

- Wiki: `projects/wiki/projects/virality/pages/architecture/tiktok-polling-live-data.md` — canonical architecture reference for the three-layer bug and the full polling pipeline
- Plan: `docs/plans/2026-04-13-002-fix-polling-milestone-data-display-plan.md` — the feature that was unblocked by this fix
- Plan: `docs/plans/2026-03-28-001-feat-oracle-library-live-market-refresh-plan.md` — original SWR introduction (fetcher defined without `cache: "no-store"` — predates this fix)
- Todo: `todos/102-pending-p2-swr-duplicate-fetcher-refs.md` — why the shared `marketFetcher` module is the correct home for the Layer 3 fix
- Todo: `todos/112-complete-p2-betsheet-swr-fetcher-not-shared.md` — resolved; BetSheet now uses shared `marketFetcher` with Layer 3
- Plan: `docs/plans/2026-04-19-003-fix-progress-bar-stale-cache-plan.md` — documents the 2026-04-19 regression fix for feed polls Layer 2 and marketFetcher Layer 3
