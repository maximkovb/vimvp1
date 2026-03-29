---
date: 2026-03-28
topic: oracle-and-live-market-page
---

# Oracle Library + Live Market Page

## Problem Frame

The oracle polling and resolution logic lives embedded inside two Vercel cron route
handlers. There is no shared library boundary, making it hard to unit-test or reuse.
The market detail page is also a pure server component — it shows stale data until
the user manually reloads, which undermines the live prediction-market feel.

## Requirements

- R1. Create `src/lib/oracle.ts` exporting two async functions:
  - `fetchYouTubeStats(videoId)` — calls YouTube Data API v3 statistics endpoint using
    `YOUTUBE_API_KEY`; returns `{ viewCount, likeCount, timestamp }`.
  - `resolveMarket(marketId)` — fetches the latest poll for the market, compares the
    relevant metric (`viewCount` or `likeCount`) against `milestoneThreshold`, sets
    `outcome` (1=YES, 0=NO), distributes LMSR payouts via the existing `distributePayout`
    service, and transitions market status to `"resolved"` — all in a single DB transaction.

- R2. Refactor the existing cron route handlers to call the new shared functions:
  - `/api/cron/poll-youtube` calls `fetchYouTubeStats` for each market that needs polling.
  - `/api/cron/resolve-markets` calls `resolveMarket` for each market in `"resolving"` status.
  - No behavioral change — the two-route structure is preserved for independent Vercel schedules.

- R3. Add a `/api/markets/[id]` GET endpoint that returns current market state:
  market fields, latest prices, recent trades (last 20), price snapshot history,
  and poll history. No auth required (read-only public data).

- R4. Convert the market detail page (`src/app/markets/[id]/page.tsx`) so that the
  dynamic sections (odds, trade history, price chart, stats chart) refresh every 60s
  client-side via SWR, while the page shell (video embed, description, channel history,
  market details) stays server-rendered for fast initial load.

- R5. Show a subtle "last updated" timestamp or live indicator near the charts so users
  know the data is refreshing automatically.

## Success Criteria

- The two cron routes call into `src/lib/oracle.ts` and contain no duplicated YouTube API
  or resolution logic.
- A resolved market (outcome set, payouts distributed) can be triggered by calling
  `resolveMarket(marketId)` directly without going through a cron HTTP handler.
- The market page updates odds, trade history, price chart, and stats chart every 60s
  without a full page reload.
- No regressions in the halt → resolving → resolved state machine.

## Scope Boundaries

- No new schema changes needed — `youtubePolls` already has `marketId` FK and all required fields.
- `src/lib/cron/poller.ts` (unified handler) is **out of scope** — two separate cron routes
  are retained as-is per user decision.
- Trading actions (buy/sell) are not affected and remain server actions.
- Channel history (`ChannelHistorySection`) is excluded from the SWR refresh — it's
  cached server-side and changes rarely.

## Key Decisions

- **Two cron routes retained**: They can run on different Vercel cron schedules (e.g., poll
  every 5 min, resolve every 1 min). A unified handler would lose that flexibility.
- **Full market data refresh (not stats-only)**: Odds and trade history staleness matter
  for traders, not just the stats chart.
- **Server shell + SWR client section**: Avoids converting the entire page to a client
  component. Video embed, description, and channel history remain SSR.

## Dependencies / Assumptions

- `distributePayout(tx, marketId, outcome)` in `src/lib/services/payout.ts` is the
  existing canonical payout function — `resolveMarket` will call it.
- SWR is not yet in the project's dependencies; it will need to be added.
- The `/api/markets/[id]` endpoint must serialize `BigInt` fields (viewCount, likeCount,
  milestoneThreshold) to strings or numbers before sending JSON.

## Outstanding Questions

### Resolve Before Planning
_(none — all product decisions resolved)_

### Deferred to Planning

- [Affects R3][Technical] Does the project already have SWR installed? Check `package.json`.
- [Affects R4][Technical] Determine the cleanest split point: which sections become a
  `"use client"` component vs. which stay in the server page component.
- [Affects R1][Technical] `fetchYouTubeStats` should not use Next.js `next: { revalidate }`
  cache (cron calls need fresh data). Confirm `cache: "no-store"` is the right fetch option
  for the oracle context vs. the existing admin/channel fetch helpers which do cache.

## Next Steps
→ `/ce:plan` for structured implementation planning
