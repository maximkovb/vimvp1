---
date: 2026-03-29
topic: poll-frequency-view-trajectory
---

# Poll Frequency — View Trajectory Freshness

## Problem Frame

The YouTube stats cron runs every 5 minutes but uses adaptive polling tiers that
throttle most markets to a 2-hour (>24h remaining) or 30-minute (1–24h remaining)
poll interval. As a result, the view trajectory chart on the market detail page can
show data that is hours old. The user-visible data must never be more than 10 minutes
stale for any active market.

The UI layer (SWR, API route) already works correctly — it serves whatever rows are in
`youtubePolls`. The gap is that new rows are inserted far too infrequently.

## Requirements

- R1. All active (and halted) markets must receive a new `youtubePolls` row at least
      once every 10 minutes, regardless of time remaining until resolution.
- R2. The cron's existing 5-minute schedule is sufficient headroom to satisfy R1 —
      no schedule change is needed.
- R3. The UI/SWR layer is unchanged (already refreshes every 60s).

## Success Criteria

- A market created with 48h resolution shows a new data point in its trajectory chart
  within 10 minutes of creation, and every ≤10 minutes thereafter.
- No increase in YouTube API quota usage beyond what satisfying R1 requires.

## Scope Boundaries

- Do not change the Vercel cron schedule.
- Do not change the SWR refresh interval or the API route.
- Do not add a new polling mechanism — the existing cron is the only poller.
- Market resolution logic and payout flow are out of scope.

## Key Decisions

- **Flatten the >24h tier to ≤10 min:** The original 2-hour throttle for far-future
  markets was a quota optimisation. At typical scale (tens to low hundreds of markets),
  batched YouTube API calls consume well under the 10,000 daily quota units even at
  5-min intervals — the optimisation creates more UX harm than quota it saves.
- **Keep tiering if desired, but cap max interval at 10 min:** An alternative is to
  keep tiered values but lower the ceiling (e.g. 10 min for >24h, 5 min for <24h,
  5 min for <1h). This is equivalent in outcome for R1.

## Next Steps
→ `/ce:plan` for structured implementation planning
