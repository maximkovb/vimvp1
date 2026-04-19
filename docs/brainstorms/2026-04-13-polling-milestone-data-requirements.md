---
date: 2026-04-13
topic: polling-milestone-data
---

# Polling & Milestone Data Fix

## Problem Frame

Milestone data (TikTok views/likes vs. target) does not update after a market is created, in
both local dev and production. There are two distinct problems:

1. **UI gap**: The `VideoStatsChart` component (milestone progress over time) exists but is
   never rendered anywhere. No chart appears on the market detail page showing the video's
   views/likes history against the milestone target.

2. **Dev polling gap**: In local development, Vercel cron jobs never fire. There is no
   mechanism to trigger TikTok polling when running `npm run dev`, so milestone data is always
   stale (whatever was seeded at market creation). Components that read `pollHistory` show
   nothing or show only the initial snapshot.

3. **Production timing drift**: The cron schedule (`*/10 * * * *`) combined with the
   `shouldPoll` >= 10-minute guard can allow up to ~19-minute gaps between polls in edge cases,
   rather than a consistent 10-minute cadence.

## Requirements

- R1. When the Next.js server starts (both `dev` and production), an immediate TikTok poll fires
  for all active and halted markets before the first cron tick.
- R2. In local development, TikTok polling repeats on a 10-minute interval for as long as the
  server is running, matching production cron behavior.
- R3. The market detail page renders the `VideoStatsChart` component, showing the video's
  views (or likes, per `questionType`) over time with the milestone target as a reference line.
  The chart is populated from `pollHistory` and updates live via the existing SWR refresh cycle.
- R4. All milestone data displays — the views/likes numbers in `LiveEngagementStats`, and the
  `VideoStatsChart` — must reflect the latest `pollHistory` returned by `GET /api/markets/[id]`
  without requiring a page reload.
- R5. The production cron cadence must deliver polls on a consistent ~10-minute schedule. The
  `shouldPoll` gate (or the cron schedule) should be adjusted so that the effective interval
  between polls for any active market is reliably 10 minutes, not up to ~19.

## Success Criteria

- Opening a market detail page in `npm run dev` shows milestone chart data within 10 minutes of
  server start, and that data refreshes every 10 minutes without manual intervention.
- The milestone progress chart (`VideoStatsChart`) is visible on the market detail page for any
  active market that has at least one poll row.
- In production, poll timestamps in `tiktok_polls` are spaced no more than ~11 minutes apart
  for any active market during normal operation.

## Scope Boundaries

- Not changing the TikTok data-fetching logic itself (`fetchTikTokStatsById`) or the polling
  cron handler business logic — only when and how the cron is triggered.
- Not adding a dedicated milestone progress bar or percentage UI — the `VideoStatsChart` already
  provides the visual; just wire it in.
- Not changing the `LiveEngagementStats` SWR refresh interval (60 s) — it already re-reads
  `pollHistory` on each tick, which is sufficient.

## Key Decisions

- **Use Next.js instrumentation hook for dev polling**: `src/instrumentation.ts` (registered via
  `experimental.instrumentationHook`) runs once on server startup and can schedule a
  `setInterval` to call the poll endpoint internally. This avoids external process management.
- **Remove or lower the `shouldPoll` 10-minute guard for the cron handler**: Since the Vercel
  cron already fires every 10 minutes, the in-handler guard is redundant and introduces drift.
  Polling everything eligible on each cron tick is safe and achieves the "sharp and consistent"
  requirement.

## Dependencies / Assumptions

- `CRON_SECRET` must be available in the dev environment (`.env.local`) for the instrumentation
  hook to authenticate its internal poll requests.
- The `VideoStatsChart` component is already built and correct; no changes to it are needed.
- `pollHistory` is already returned by `GET /api/markets/[id]` and threaded through SWR to both
  `LiveEngagementStats` and `MarketLiveData` — the chart just needs to be rendered using that
  data.

## Outstanding Questions

### Resolve Before Planning
_(none)_

### Deferred to Planning

- [Affects R1, R2][Technical] Confirm whether `instrumentation.ts` runs in the edge runtime or
  Node.js runtime on Vercel, and whether `setInterval` is supported. Alternative: a lightweight
  `/api/startup` route called from `instrumentation.ts`.
- [Affects R3][Needs research] Determine the exact location to render `VideoStatsChart` —
  inside `MarketLiveData` (which already has the SWR subscription) is the likely answer, but
  confirm that `pollHistory` flows through to that component correctly.
- [Affects R5][Technical] Confirm that dropping the `shouldPoll` 10-minute guard is safe — i.e.,
  there's no scenario where the cron fires more than once per 10-minute window that would cause
  double-polling.

## Next Steps

→ `/ce:plan` for structured implementation planning
