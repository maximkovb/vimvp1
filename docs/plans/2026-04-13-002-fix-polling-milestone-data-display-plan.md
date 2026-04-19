---
title: "fix: Polling Cadence and Milestone Data Display"
type: fix
status: completed
date: 2026-04-13
origin: docs/brainstorms/2026-04-13-polling-milestone-data-requirements.md
---

# fix: Polling Cadence and Milestone Data Display

## Overview

Milestone data (TikTok views/likes vs. target) never updates in the UI after market creation.
Two independent problems cause this: (1) `VideoStatsChart` — the component that shows the
milestone progress chart — is fully built but never rendered anywhere, and (2) in local
development Vercel cron jobs never run so no new TikTok data is ever fetched. A third issue
causes production polls to fire every ~20 minutes instead of every ~10.

This plan addresses all three via four focused changes.

---

## Problem Statement

- `VideoStatsChart` (`src/components/VideoStatsChart.tsx`) is a complete, working component
  that no parent ever imports. The market detail page has no milestone chart.
- `MarketLiveData` receives `pollHistory` from SWR but ignores it entirely — no rendering code
  reads `market.pollHistory`.
- In development, `vercel.json` cron jobs never fire. There is no startup hook, no npm script
  registered in `package.json`, and `poll-local.ps1` (the only workaround) is PowerShell-only
  and embeds a hardcoded credential (`vasyakosmos12`) that must be rotated.
- The `shouldPoll` guard (`>= 10 * 60 * 1000`) combined with the `*/10` Vercel cron schedule
  causes systematic drift: the cron fires at :00/:10/:20… but each poll completes a few seconds
  after the cron fires, so `lastPollAt` is always a few seconds past the tick. The next cron
  invocation, exactly 10 minutes later, sees `elapsed < 10 min` and skips. The effective
  cadence becomes ~20 minutes.
- `LiveEngagementStats` uses a fixed `refreshInterval: 60_000` regardless of market status,
  while `MarketHUD` correctly switches to 10s when halted/resolving.

*(see origin: docs/brainstorms/2026-04-13-polling-milestone-data-requirements.md)*

---

## Proposed Solution

Four targeted changes, each independently deployable:

1. **Lower the `shouldPoll` threshold** from 10 minutes to 9 minutes. One-line fix that
   immediately restores the intended ~10-minute cadence in production.
2. **Extract poll logic** from the cron route handler into a shared
   `src/lib/poll-active-markets.ts` function. The route becomes a thin wrapper. This enables
   direct in-process calls without HTTP loopback or auth token juggling.
3. **Add `src/instrumentation.ts`** with a `register()` export that calls
   `pollAllActiveMarkets()` immediately on startup and, in development only, schedules a
   10-minute interval — matching Vercel cron behavior locally. A `globalThis` guard prevents
   duplicate intervals (Next.js 16 can invoke `register()` 2–3 times in dev).
4. **Wire `VideoStatsChart` into `MarketLiveData`** using `market.pollHistory` and
   `market.milestoneThreshold` already present in the SWR data. Add an empty-state placeholder
   matching the price chart pattern. Fix `LiveEngagementStats` adaptive interval as a
   low-risk follow-on.

---

## Technical Considerations

### Instrumentation hook — Vercel serverless caveat

`setInterval` does **not** tick on Vercel serverless deployments — the process is frozen between
requests. Vercel cron is the production scheduler. `instrumentation.ts` handles the first-deploy
gap (immediate startup poll on cold start), while the cron handles regular cadence. The interval
`setInterval` is only reliable locally.

Gate all Node.js-specific code with `NEXT_RUNTIME === 'nodejs'` (required; edge runtime has no
`setInterval`) and use a dynamic import pattern:

```typescript
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initPolling } = await import('./lib/instrumentation-polling')
    void initPolling() // fire-and-forget — don't block server startup
  }
}
```

### GlobalThis guard — prevents duplicate intervals in dev

Next.js 16 `register()` can fire 2–3 times during dev server startup (multiple worker
evaluations). Guard with a `globalThis` flag:

```typescript
// src/lib/instrumentation-polling.ts
declare global {
  var __pollInterval: ReturnType<typeof setInterval> | undefined
}

export async function initPolling() {
  // In dev: guard prevents duplicate intervals from register() firing 2–3 times.
  // In production: __pollInterval is never set (no setInterval), so this guard
  // never fires — each cold start polls once, with shouldPoll as the rate limiter.
  if (globalThis.__pollInterval) return

  // Immediate startup poll
  await pollAllActiveMarkets()

  if (process.env.NODE_ENV === 'development') {
    globalThis.__pollInterval = setInterval(
      () => void pollAllActiveMarkets(),
      10 * 60 * 1000
    )
    globalThis.__pollInterval.unref?.() // Don't block clean shutdown
  }
}
```

### Dual-location config trap (from institutional learnings)

The 10-minute constant appears in two places: `vercel.json` schedule string and the `shouldPoll`
guard. After lowering the guard to 9 minutes these will intentionally differ (cron fires every
10, guard allows at 9+). Document this in a comment so no future maintainer "corrects" the guard
back to 10.

### BigInt / Number casting (from institutional learnings)

`market.milestoneThreshold` is typed as `string` in `MarketData` (BigInt serialized through
JSON). Use `Number(market.milestoneThreshold)` when passing to `VideoStatsChart`'s `milestone`
prop, consistent with `MarketLiveData`'s existing cast at line 63.

### `VideoStatsChart` empty state

The component renders an invisible zero-height div when `data.length === 0`. The calling site
must conditionally render with an explicit "No data yet" placeholder matching the `PriceChart`
fallback pattern in `MarketLiveData`:

```tsx
{chartData.length > 0 ? (
  <VideoStatsChart data={chartData} milestone={milestoneNumber} metricLabel={market.questionType} />
) : (
  <div className="h-48 flex items-center justify-center text-muted text-sm">
    No stats yet — first poll fires within 10 minutes
  </div>
)}
```

### Security: hardcoded secret in poll-local.ps1

`scripts/poll-local.ps1` embeds `vasyakosmos12` directly. This plan supersedes that script —
the startup polling via `instrumentation.ts` makes it unnecessary in dev. The script should be
removed and `CRON_SECRET` rotated. If a manual trigger is still desired, a new `scripts/poll-
local.sh` should read from `.env.local` via `grep` or `dotenv`.

---

## System-Wide Impact

- **Interaction graph**: `instrumentation.ts` `register()` → `initPolling()` → `pollAllActiveMarkets()` → DB read (active markets) → TikWM fetch per market → DB insert into `tiktok_polls`. On the UI side: SWR revalidates `GET /api/markets/[id]` → reads `tiktok_polls` → returns updated `pollHistory` → `MarketLiveData` re-renders `VideoStatsChart` → chart data updates.
- **Error propagation**: `pollAllActiveMarkets()` catches per-market errors and continues (existing behavior). Errors in `initPolling()` are swallowed by the `setInterval` callback — add a `console.error` wrapper. The cron route's `verifyCronAuth` wrapper is bypassed by the direct call but that is intentional (internal process, no HTTP boundary).
- **State lifecycle risks**: None new. The `shouldPoll` guard prevents double-polling even if `register()` fires multiple times — it checks `lastPollAt` from the DB, which is the correct distributed lock.
- **API surface parity**: The cron route `GET /api/cron/poll-tiktok` continues to work unchanged as a thin wrapper. No new public API surface is added.
- **Integration test scenarios**:
  - No active markets → `pollAllActiveMarkets()` returns early, no errors
  - Market with null `resolvesAt` → `shouldPoll` returns false, market is skipped (existing guard preserved)
  - `register()` called twice in dev → second call exits immediately at `globalThis.__pollInterval` guard, no second interval
  - Vercel serverless cold start → `register()` fires, `pollAllActiveMarkets()` runs, no interval registered (only dev sets the interval)

---

## Acceptance Criteria

- [ ] Running `npm run dev` triggers a TikTok poll for all active/halted markets within server startup, visible in console output
- [ ] In dev, subsequent polls fire every 10 minutes automatically without manual intervention
- [ ] The `VideoStatsChart` chart section is visible on the market detail page for any active market with at least one poll row
- [ ] The chart shows the correct metric (views vs. likes) based on `questionType`
- [ ] An empty-state placeholder appears when `pollHistory` is empty (no polls yet)
- [ ] Chart data updates on the next SWR revalidation cycle after new poll data arrives — no page reload needed
- [ ] Production cron poll timestamps in `tiktok_polls` are spaced no more than ~11 minutes apart (verify by checking `MAX(polled_at)` timestamps over a 1-hour window)
- [ ] `LiveEngagementStats` refresh interval adapts to 10s when market is halted or resolving
- [ ] Running `register()` twice (simulating dev multi-worker) results in exactly one active interval (check via `globalThis.__pollInterval`)
- [ ] `scripts/poll-local.ps1` removed and `CRON_SECRET` rotated

---

## Implementation Steps

### Step 1 — Fix `shouldPoll` threshold (1 line, independent)

**File:** `src/app/api/cron/poll-tiktok/route.ts:23`

Change:
```typescript
return Date.now() - lastPollAt.getTime() >= 10 * 60 * 1000;
```
To:
```typescript
// 9-min threshold: the Vercel cron fires every 10 min but polls complete a few seconds
// after the cron tick, so lastPollAt is always slightly ahead of the next tick.
// 9 min absorbs this drift while still blocking genuine rapid duplicates.
return Date.now() - lastPollAt.getTime() >= 9 * 60 * 1000;
```

### Step 2 — Extract `pollAllActiveMarkets` shared function

**New file:** `src/lib/poll-active-markets.ts`

Extract the core logic currently inside the `GET` handler of `src/app/api/cron/poll-tiktok/route.ts`:
- DB fetch of active/halted markets
- Last-poll-time SQL query
- `shouldPoll` filter (or `force` override)
- Per-market fetch loop (TikWM, null guard, insert, metadata update, auto-resolve)

Function signature:
```typescript
export async function pollAllActiveMarkets(force = false): Promise<PollResult>
```

The cron route's `GET` handler becomes:
```typescript
export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;
  const force = new URL(request.url).searchParams.get("force") === "true";
  const result = await pollAllActiveMarkets(force);
  return NextResponse.json(result);
}
```

### Step 3 — Add `src/lib/instrumentation-polling.ts`

```typescript
// src/lib/instrumentation-polling.ts
import { pollAllActiveMarkets } from './poll-active-markets'

declare global {
  var __pollInterval: ReturnType<typeof setInterval> | undefined
}

const POLL_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes — matches vercel.json */10 schedule

export async function initPolling(): Promise<void> {
  if (globalThis.__pollInterval) {
    console.log('[polling] already running, skipping duplicate register()')
    return
  }

  console.log('[polling] server startup — running immediate poll')
  try {
    const result = await pollAllActiveMarkets()
    console.log('[polling] startup poll complete:', result)
  } catch (err) {
    console.error('[polling] startup poll failed:', err)
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`[polling] scheduling interval every ${POLL_INTERVAL_MS / 60_000} min (dev only)`)
    globalThis.__pollInterval = setInterval(async () => {
      try {
        const result = await pollAllActiveMarkets()
        console.log('[polling] interval poll complete:', result)
      } catch (err) {
        console.error('[polling] interval poll failed:', err)
      }
    }, POLL_INTERVAL_MS)
    globalThis.__pollInterval.unref?.()
  }
}
```

### Step 4 — Add `src/instrumentation.ts`

```typescript
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initPolling } = await import('./lib/instrumentation-polling')
    void initPolling() // fire-and-forget — don't block server startup
  }
}
```

### Step 5 — Wire `VideoStatsChart` into `MarketLiveData`

**File:** `src/components/MarketLiveData.tsx`

1. Import `VideoStatsChart`
2. Map `market.pollHistory` to `{time: UTCTimestamp, value: number}[]` using `questionType`:
   ```typescript
   const statsChartData = market.pollHistory
     .filter((p) => market.questionType === 'views' ? p.viewCount != null : p.likeCount != null)
     .map((p) => ({
       time: Math.floor(new Date(p.time).getTime() / 1000) as UTCTimestamp,
       value: market.questionType === 'views' ? p.viewCount! : p.likeCount!,
     }))
   ```
3. Add a "Video Stats" section between the channel history children and the price chart:
   ```tsx
   {/* Video stats chart — milestone progress */}
   <div className="bg-card border border-border rounded-xl p-4">
     <h2 className="text-sm font-medium text-muted mb-3">
       {market.questionType === 'views' ? 'View' : 'Like'} Progress
     </h2>
     {statsChartData.length > 0 ? (
       <VideoStatsChart
         data={statsChartData}
         milestone={milestoneNumber}
         metricLabel={market.questionType}
       />
     ) : (
       <div className="h-48 flex items-center justify-center text-muted text-sm">
         No stats yet — first poll fires within 10 minutes
       </div>
     )}
   </div>
   ```

### Step 6 — Fix `LiveEngagementStats` adaptive interval

**File:** `src/components/LiveEngagementStats.tsx`

Change the `useSWR` call to use the same adaptive `refreshInterval` as `MarketHUD`:
```typescript
const { data } = useSWR<MarketData>(
  `/api/markets/${marketId}`,
  marketFetcher,
  {
    refreshInterval: (latestData) => {
      const status = latestData?.status ?? initialData.status;
      return status === 'halted' || status === 'resolving' ? 10_000 : 60_000;
    },
    fallbackData: initialData,
  }
)
```

### Step 7 — Remove `poll-local.ps1` and rotate `CRON_SECRET`

- Delete `scripts/poll-local.ps1`
- Generate a new `CRON_SECRET` value and update:
  - `.env.local` (developer machines)
  - Vercel environment variables (production)
- Optionally add `scripts/poll-local.sh` that reads from `.env.local`:
  ```bash
  #!/bin/bash
  source .env.local
  curl -s -H "Authorization: Bearer $CRON_SECRET" \
    "http://localhost:3000/api/cron/poll-tiktok?force=true" | jq .
  ```

---

## Dependencies & Risks

- **`instrumentation.ts` on Vercel**: confirmed that `setInterval` does not work in serverless.
  The plan guards this with `NODE_ENV === 'development'`. In production the startup call still
  fires (handles first-deploy gap), but ongoing cadence is the Vercel cron's responsibility.
- **`pollAllActiveMarkets` extraction**: the cron handler currently references `db`, `markets`,
  `tiktokPolls`, `fetchTikTokStatsById`, `resolveMarket`, etc. The extracted function needs all
  these imports. Ensure no circular imports (`market-fetcher.ts` must not import from the poll
  function or vice versa).
- **TikWM rate limit**: the 1.1s sleep per market means startup poll on many active markets takes
  seconds. `initPolling()` is called with `void` (fire-and-forget) so the server starts accepting
  requests immediately. The poll runs in the background.
- **CRON_SECRET in dev**: `instrumentation-polling.ts` calls `pollAllActiveMarkets()` directly
  (no HTTP, no auth header). The `CRON_SECRET` env var does not need to be set for startup
  polling to work. It is still required for the HTTP cron endpoint and the optional bash script.
- **Hardcoded secret rotation**: `vasyakosmos12` in the deleted `poll-local.ps1` is a credential.
  Rotate before merging — if it was ever committed to git history, treat the secret as
  compromised regardless.

---

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-04-13-polling-milestone-data-requirements.md](../brainstorms/2026-04-13-polling-milestone-data-requirements.md)
  Key decisions carried forward: (1) instrumentation.ts for startup/dev polling, (2) lower shouldPoll guard to fix drift, (3) wire VideoStatsChart into MarketLiveData using existing SWR data

### Internal References

- Cron route: `src/app/api/cron/poll-tiktok/route.ts:16–24` — `shouldPoll` function
- VideoStatsChart: `src/components/VideoStatsChart.tsx` — fully built, never imported
- MarketLiveData: `src/components/MarketLiveData.tsx:66` — `milestoneNumber` cast pattern to reuse
- LiveEngagementStats: `src/components/LiveEngagementStats.tsx:17` — interval to fix
- MarketHUD: `src/components/MarketHUD.tsx:35` — adaptive interval reference implementation
- MarketData type: `src/types/market.ts:10,42` — `milestoneThreshold` and `pollHistory` fields
- Shared fetcher: `src/lib/market-fetcher.ts` — stable SWR fetcher reference

### Institutional Learnings

- `docs/solutions/logic-errors/tiktok-market-resolution-race-condition.md` — dual-location config
  trap: `vercel.json` and `shouldPoll` must be updated together; document the intentional mismatch
- `docs/solutions/logic-errors/neon-timestamp-utc-offset-cron-cooldown-null-poll-guard.md` — null
  poll row guard (already applied), timezone-safe timestamp extraction (already applied)

### External References

- [Next.js Instrumentation Docs](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation) — stable in v16, no experimental flag
- [Next.js Guides: Instrumentation](https://nextjs.org/docs/app/guides/instrumentation) — `NEXT_RUNTIME` gating, dynamic import pattern
