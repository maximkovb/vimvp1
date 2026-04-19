---
date: 2026-04-13
topic: creator-baseline-card
---

# Creator Baseline Card

## Problem Frame

Users betting on TikTok video milestone markets have no context for whether a
video is performing well *for that creator*. A video at 1.2M views means
something different for a channel that averages 2M vs. 300K. Users currently
bet blind on the raw video and market price alone.

The Creator Baseline Card surfaces the current video's view velocity relative
to the creator's recent historical average — so users can judge whether this
video is an outlier or business as usual before committing a bet.

## Requirements

- **R1.** A "Creator Baseline" card renders as a separate section directly
  below the existing creator card on the market page (`/markets/[id]`).

- **R2.** The card header is always visible and shows the verdict and delta
  at a glance: e.g., "▲ Ahead of pace +47%" or "▼ Behind pace −23%". The
  card starts **collapsed** by default; the user taps/clicks to expand.

- **R3.** The verdict is one of three tiers — **Ahead of pace**, **On pace**,
  **Behind pace** — determined by comparing the current video's views-per-hour
  to the creator's median views-per-hour across their recent videos.

- **R4.** When expanded, the card shows:
  - This video's views/hr (computed from current view count ÷ hours since publish)
  - Creator's median views/hr (computed from recent N videos)
  - Percentage difference
  - "Based on N recent videos" (where N is the number of videos used)

- **R5.** Data is fetched **live on page load** via a new client-side API
  endpoint that calls TikWM's user/posts endpoint for the creator's recent
  videos. The `creatorId` stored in `videoMetadata` is used as the lookup key.

- **R6.** When fewer than 3 recent creator videos are available, or when the
  TikWM request fails, the card renders in a **"Not enough data"** state:
  the header shows only "Creator Baseline" (no verdict), and the expanded
  body shows "Not enough data yet. Check back as more videos are published."
  The card does **not** disappear — it stays visible to signal the feature
  exists.

- **R7.** If `videoMetadata.creatorId` is missing or empty for a market, treat
  it identically to the "not enough data" state (R6).

- **R8.** The feature works for markets in all statuses (active, resolved,
  cancelled, etc.) — the baseline is useful for reviewing resolved markets too.

## Success Criteria

- A user viewing a market page sees whether the video is outpacing or
  underperforming the creator's norm before placing a bet — without opening
  another tab.
- The verdict renders within the normal page-load experience (client
  fetch with graceful loading state, not a blocking server render).
- The panel never shows stale or fabricated data: if real data is
  unavailable, the "not enough data" state is shown.

## Scope Boundaries

- No chart or sparkline in v1. Verdict + two-row breakdown is the full UI.
- No storing baseline data in the database. Live fetch only.
- No background refresh or cron job for this feature.
- TikTok / TikWM only. No YouTube equivalent in this scope.
- Exact verdict thresholds (what % gap triggers "ahead" vs. "on pace") are a
  planning decision — the three-tier label structure is fixed.

## Key Decisions

- **Separate card, not merged into existing creator card:** Keeps the creator
  card focused on identity + live stats; the baseline card has a distinct
  purpose (contextual signal for bettors) and benefits from its own
  expand/collapse lifecycle.
- **Velocity ratio, not trajectory chart:** TikWM only provides current view
  counts for past videos — not historical snapshots. A ratio (views/hr now vs.
  creator median) is honest about the data available and gives users a clean
  single signal.
- **Live fetch, not stored at creation:** Keeps the baseline current. A stored
  snapshot from market creation would become stale immediately for long-running
  markets; the live fetch reflects the creator's actual recent performance.
- **"Not enough data" state instead of hiding:** Showing the panel even when
  empty sets user expectation that this signal exists, and avoids a confusing
  layout shift between markets that do and don't have data.

## Dependencies / Assumptions

- `videoMetadata.creatorId` is populated for markets created with TikTok videos
  (stored as `d.author?.unique_id` from TikWM). Older markets may have an empty
  string — treat as "not enough data."
- TikWM's user/posts endpoint is accessible without authentication and returns
  recent videos with viewCount and createTime. (Needs validation during planning.)
- The new API endpoint is unauthenticated (creator profile info is public on
  TikTok). Rate-limiting considerations deferred to planning.

## Outstanding Questions

### Resolve Before Planning
_(none — all product decisions resolved)_

### Deferred to Planning
- **[R3][Technical]** Exact numeric thresholds for "ahead" / "on pace" /
  "behind" verdict (e.g., ±20% or ±30% of creator median).
- **[R5][Needs research]** Confirm TikWM user/posts API shape, pagination
  behavior, and whether it requires any special headers or rate-limit handling.
- **[R5][Technical]** How many recent creator videos to fetch (suggested: ~10).
  Confirm TikWM default page size.
- **[R5][Technical]** Whether SWR caching should be applied to the creator
  baseline fetch (to avoid redundant TikWM calls if user navigates between
  markets of the same creator).
- **[R2][Technical]** Whether the verdict delta shown in the collapsed header
  is hidden (just the tier label) or shown ("+47%") — UX call during
  implementation.

## Next Steps

→ `/ce:plan` for structured implementation planning
