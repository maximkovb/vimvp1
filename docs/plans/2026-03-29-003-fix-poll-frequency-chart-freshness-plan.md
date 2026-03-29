---
title: "fix: Poll frequency — view trajectory chart staleness"
type: fix
status: completed
date: 2026-03-29
origin: docs/brainstorms/2026-03-29-poll-frequency-view-trajectory-requirements.md
---

# fix: Poll frequency — view trajectory chart staleness

## Overview

The YouTube stats cron (`/api/cron/poll-youtube`) runs every 5 minutes but uses
adaptive polling tiers that limit most markets to a 2-hour (>24h remaining) or
30-minute (1–24h remaining) insert interval. The view trajectory chart on the market
detail page reflects `youtubePolls` DB rows, so it is hours stale for newly created
markets. The fix is a 3-line change to `shouldPoll()` so no active market ever waits
more than 10 minutes between polls.

## Problem Statement / Motivation

- Markets created with 48h resolution (including all quick-create test markets) have
  `resolvesAt > now + 24h`, placing them in the 2-hour tier. Their chart shows a flat
  line with a single initial data point for the first two hours.
- The 30-minute tier for markets 1–24h from resolution is also too coarse for a
  prediction-market product where odds are updating in real time.
- The cron's 5-minute schedule already provides the infrastructure to poll far more
  frequently — only the `shouldPoll` thresholds need to change.
- At typical scale (tens to low hundreds of active markets), batching 50 video IDs per
  YouTube API call keeps quota well within the 10,000-unit daily limit even at 5-minute
  intervals. (See origin: docs/brainstorms/2026-03-29-poll-frequency-view-trajectory-requirements.md)

## Proposed Solution

Flatten all tier intervals to **5 minutes**. Since the cron fires every 5 minutes, this
means every active market is polled on every cron run. The tiering system can be removed
or collapsed — keep the code readable by either:

**Option A (simplest):** Remove tiered logic; always return `true` when `lastPollAt` is
≥5 min ago (or null):

```ts
// src/app/api/cron/poll-youtube/route.ts
function shouldPoll(
  market: { resolvesAt: Date | null; status: string },
  lastPollAt: Date | null
): boolean {
  if (!market.resolvesAt) return false;
  if (market.status !== "active" && market.status !== "halted") return false;
  if (!lastPollAt) return true;
  return Date.now() - lastPollAt.getTime() >= 5 * 60 * 1000;
}
```

**Option B (keep tiering, lower ceiling):** Lower the >24h tier from 2h → 5min, and
1–24h tier from 30min → 5min. This preserves the tiering structure in case tiers are
reintroduced later.

Option A is recommended — the tiers were an optimisation that is no longer warranted and
their removal makes the function simpler and the behaviour obvious.

## Technical Considerations

- **No DB migration required** — `youtubePolls` schema is unchanged.
- **No cron schedule change** — remains `*/5 * * * *` in `vercel.json`.
- **No UI or API route changes** — the data pipeline (cron → DB → API → SWR → chart)
  is already correct end-to-end; only insertion frequency was wrong.
- **Quota impact:** `videos.list?part=statistics` costs 1 unit per batch of up to 50 IDs.
  At 5-min intervals, 288 cron runs/day × ceil(N/50) batches. For N=100 markets: 576
  units/day (well under 10,000). Even N=500 markets yields 2,880 units/day — safe.
- **`msUntilResolve` variable becomes unused** in Option A — remove it to avoid a TS
  unused-variable warning.

## System-Wide Impact

- **Interaction graph:** Cron → `shouldPoll()` → YouTube batch API → `db.insert(youtubePolls)` → next SWR fetch → chart re-renders. No other layer is touched.
- **Error propagation:** Unchanged — per-batch YouTube API errors are already caught and logged; the function change doesn't affect error paths.
- **State lifecycle risks:** None — inserting more rows into `youtubePolls` is purely additive; the API query already limits to 500 rows ordered by `polledAt`.
- **API surface parity:** `resolveMarket` in `oracle.ts` reads `youtubePolls` for the latest poll — more frequent insertions only help resolution accuracy.

## Acceptance Criteria

- [ ] A market with `resolvesAt > now + 24h` receives a new `youtubePolls` row within
      10 minutes of the cron running
- [ ] A market with `resolvesAt` 12h away receives a new row within 10 minutes
- [ ] The view trajectory chart shows new data points after each cron run (visible
      within ≤10 minutes on the market detail page)
- [ ] `shouldPoll` no longer references the 2-hour or 30-minute tier constants
- [ ] No TypeScript build errors
- [ ] No increase in cron response time beyond natural variance from more DB inserts

## Implementation Steps

### Step 1 — Update `src/app/api/cron/poll-youtube/route.ts`

Replace the body of `shouldPoll` (lines 25–46) with Option A above.
Remove the `intervalMs` variable and the `msUntilResolve`-based branching.
Update the JSDoc comment to reflect the new behaviour:

```ts
/**
 * Returns true if the market is due for a new poll (every 5 minutes).
 * Active and halted markets are always eligible; resolved/cancelled are not.
 */
function shouldPoll(
  market: { resolvesAt: Date | null; status: string },
  lastPollAt: Date | null
): boolean {
  if (!market.resolvesAt) return false;
  if (market.status !== "active" && market.status !== "halted") return false;
  if (!lastPollAt) return true;
  return Date.now() - lastPollAt.getTime() >= 5 * 60 * 1000;
}
```

That is the entire change.

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-29-poll-frequency-view-trajectory-requirements.md](docs/brainstorms/2026-03-29-poll-frequency-view-trajectory-requirements.md)
  Key decisions carried forward: (1) flatten all tiers to ≤10 min; (2) no cron schedule
  or UI change; (3) quota impact is negligible at expected market count.

### Internal References

- Function to change: `src/app/api/cron/poll-youtube/route.ts:25` — `shouldPoll()`
- Cron schedule (unchanged): `vercel.json` — `*/5 * * * *`
- Chart component (no change): `src/components/VideoStatsChart.tsx`
- SWR consumer (no change): `src/components/MarketLiveData.tsx`
- Oracle reader (benefits from fix): `src/lib/oracle.ts` — `resolveMarket()`
