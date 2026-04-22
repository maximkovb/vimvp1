---
title: AI Projection Badge Accuracy Fix
type: requirements
status: draft
created: 2026-04-19
---

# AI Projection Badge Accuracy Fix

## Problem

The AI projection badge displays "ON TRACK" for videos that have plateaued or
sharply decelerated. Root cause: `rollingVelocityPerHour` in
`src/lib/poll-active-markets.ts` is computed over a **24-hour window** (falling
back to the oldest available poll). For a video that grew quickly days ago but
has since stalled, the 24h average still looks adequate — the badge never sees
the plateau.

Example: `/markets/9cd15e27-adb6-4b93-a884-25c3f4ff6a59` visibly can't reach
its milestone at current pace, but shows ON_TRACK.

---

## Goals

1. Badge reflects **what is happening right now**, not a stale long-window average.
2. Badge also reflects **all-time trajectory** so a brief recent spike doesn't
   flip a chronically under-performing video to BREAKING_OUT.
3. Rapid deceleration triggers AT_RISK even when current velocity still
   technically clears the required pace.
4. **Preferred error mode:** when uncertain, badge should lean toward AT_RISK
   (false negatives are acceptable; falsely reassuring ON_TRACK is not).

---

## Algorithm (replaces current `rollingVelocityPerHour` logic)

### Constants

```
DECELERATION_THRESHOLD    = 0.5   // recent velocity must drop below 50% of prior to flag
MIN_WINDOW_HOURS          = 0.25  // 15 min — minimum poll history to compute any velocity
BREAKING_OUT_RATIO        = 1.1
ON_TRACK_RATIO            = 0.8
```

### Inputs (fetched from `tiktokPolls` per market per poll cycle)

| Symbol | Definition |
|--------|-----------|
| `poll1h` | Most recent poll with `polledAt` between 1h and 3h ago |
| `poll2h` | Most recent poll with `polledAt` between 2h and 4h ago, and **not the same row as `poll1h`** |
| `pollOldest` | Oldest poll ever for this market |
| `currentMetric` | Current view/like count (just fetched from TikTok) |

**Null-metric guard:** After fetching each poll row, check that the relevant
metric column (`viewCount` or `likeCount` per `market.questionType`) is
non-null. Treat a null metric the same as a missing poll.

### Step 1 — Compute requiredVelocity

```
viewsRemaining   = milestoneThreshold - currentMetric
hoursRemaining   = (resolvesAt - now) / 3_600_000
requiredVelocity = viewsRemaining / hoursRemaining
```

This must be computed first — the deceleration signal depends on it.

### Step 2 — Compute velocity signals

```
recentVelocity  = (currentMetric - poll1h.metric) / (now - poll1h.polledAt) in hours
allTimeVelocity = (currentMetric - pollOldest.metric) / (now - pollOldest.polledAt) in hours
```

Fallback rules:
- If `poll1h` is unavailable, fall back to `pollOldest` for `recentVelocity`.
  When this fallback fires: deceleration check is disabled (`isDecelerating = false`)
  and `effectiveVelocity` collapses to `allTimeVelocity` — this is expected for
  new markets and should not be treated as a separate code branch.
- If `pollOldest` is unavailable or its window `< MIN_WINDOW_HOURS`, set both
  velocities to `null` → badge defaults to `AT_RISK`.

```
priorVelocity = (poll1h.metric - poll2h.metric)
                / (poll1h.polledAt - poll2h.polledAt) in hours
                // ~1h span (poll2h is 1h older than poll1h), matching the recentVelocity window
```

If `poll2h` is unavailable (market < 2h old, or same row as `poll1h`), set
`priorVelocityPerHour = null`. The deceleration check is skipped.

### Step 3 — Conservative effective velocity

```
effectiveVelocity = min(recentVelocity, allTimeVelocity)
```

Taking the minimum means:
- For **new markets** `allTimeVelocity ≈ recentVelocity` — no distortion.
- For **old markets** the all-time average anchors against short-lived spikes
  inflating `recentVelocity`.
- A video that stalled days ago is caught by the low `recentVelocity`; a video
  that spiked briefly is caught by the low `allTimeVelocity`.

### Step 4 — Deceleration signal

```
isDecelerating = priorVelocityPerHour is not null
             && priorVelocity > 0
             && recentVelocity < priorVelocity * DECELERATION_THRESHOLD
             && recentVelocity < requiredVelocity * BREAKING_OUT_RATIO
```

The fourth condition protects high-headroom videos: a video at 5× required pace
that slowed from 10× to 5× stays BREAKING_OUT — only borderline cases are demoted.

### Step 5 — Label

```
if (hoursRemaining <= 0)                                  → AT_RISK
if (viewsRemaining <= 0)                                  → BREAKING_OUT
if (effectiveVelocity is null || effectiveVelocity <= 0)  → AT_RISK
if (isDecelerating)                                       → AT_RISK
if (ratio >= BREAKING_OUT_RATIO)                          → BREAKING_OUT
if (ratio >= ON_TRACK_RATIO)                              → ON_TRACK
else                                                      → AT_RISK
```

where `ratio = effectiveVelocity / requiredVelocity`.

---

## Implementation Scope

### `src/lib/projection.ts`

Replace the current signature:

```ts
computeProjectionLabel({
  currentMetric,
  rollingVelocityPerHour,
  milestoneThreshold,
  resolvesAt,
})
```

With:

```ts
computeProjectionLabel({
  currentMetric,
  recentVelocityPerHour,    // 1h window (or oldest fallback)
  allTimeVelocityPerHour,   // oldest poll to now
  priorVelocityPerHour,     // ~1h window from 1–2h ago (nullable)
  milestoneThreshold,
  resolvesAt,
})
```

Extract all threshold values as named constants at the top of the file
(`DECELERATION_THRESHOLD`, `BREAKING_OUT_RATIO`, `ON_TRACK_RATIO`,
`MIN_WINDOW_HOURS`).

### `src/lib/poll-active-markets.ts`

Replace the `oldPoll24h / oldestPoll` query block with three targeted queries:

| Query | Purpose |
|-------|---------|
| Latest poll with `polledAt` between 1h and 3h ago | `recentVelocity` baseline |
| Latest poll with `polledAt` between 2h and 4h ago, different row from above | `priorVelocity` baseline |
| Oldest poll ever | `allTimeVelocity` baseline |

### `src/app/api/cron/update-badges/route.ts`

**Must also be updated.** This cron route contains an identical copy of the
current velocity-computation block and calls `computeProjectionLabel` with the
old single-velocity signature. After this change it will silently overwrite the
correct labels written by `poll-active-markets.ts`. Apply the same three-query
pattern and new function signature here.

---

## Non-Goals

- No schema changes required.
- No changes to badge rendering (`FeedCard.tsx`) or the three label values
  (`ON_TRACK`, `AT_RISK`, `BREAKING_OUT`).
- No changes to poll frequency or the cron schedule.
- The existing `tiktok_polls_market_polled_idx` index (marketId, polledAt)
  covers all new query patterns — no new indexes needed.

---

## Acceptance Criteria

1. A video with zero growth for the past hour that cannot mathematically reach
   its milestone shows **AT_RISK**.
2. A video whose all-time average is below required pace shows **AT_RISK** even
   if the last hour saw a spike (short-term spike does not flip to ON_TRACK).
3. A video decelerating sharply (last-hour velocity < 50% of prior-hour
   velocity) shows **AT_RISK** (subject to OQ-1 resolution).
4. A video consistently growing well above required pace shows **BREAKING_OUT**.
5. A brand-new market (< 15 min of poll history) shows **AT_RISK** (conservative
   default, same as today).
6. A video that grew quickly more than 24 hours ago but has had near-zero growth
   for several hours shows **AT_RISK** (motivating example from problem
   statement — `min(recent, allTime)` must catch this case).
