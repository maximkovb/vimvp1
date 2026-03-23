---
date: 2026-03-23
topic: market-detail-video-intelligence
---

# Market Detail: Video Intelligence & Enhanced UX

## Problem Frame

Users on a market detail page need enough context to make a confident YES/NO prediction about whether a video will hit its milestone (views or likes). Currently the page shows the video embed, price history, and recent trades — but none of the actual video performance data that determines the outcome. The `youtubePolls` table already collects view/like counts over time but this data is never shown. Users also have no sense of the channel's typical performance, making the milestone target feel arbitrary.

## Requirements

- R1. **Video stats trajectory** — Display a chart of the video's actual view (or like) count over time, sourced from the existing `youtubePolls` data. The milestone target should be overlaid as a reference line so users can see current progress and trajectory toward the goal.
- R2. **Video description** — Show the YouTube video's description on the market page. If not yet stored in `videoMetadata`, it should be fetched from the YouTube API and persisted.
- R3. **Channel past performance** — Fetch the channel's 5–10 most recent videos from the YouTube Data API and display them as a card list: thumbnail, title, view count, and like count per card. This gives users a baseline for what's "normal" for this creator and whether the milestone is ambitious or modest.
- R4. **UX reorganization** — The market detail page should be restructured to surface video intelligence prominently. A dedicated "Video Intelligence" section should group: video description, stats trajectory, and channel history. This section should appear above the price chart to orient the user before they trade.

## Success Criteria

- A user landing on a market page can immediately see: how many views/likes the video currently has, the trajectory over time, and how that compares to the milestone target.
- A user can see 5–10 recent videos from the same channel as thumbnail cards with view/like counts, giving them a feel for the creator's typical reach.
- A user can read the video description without leaving the page.
- These additions do not disrupt the trade panel or the existing price chart.

## Scope Boundaries

- Channel history shows view/like counts of past videos only — not a full channel analytics dashboard.
- No user-level position or P&L display (this is a separate potential feature).
- No community sentiment or crowd trading pattern analysis.
- The channel history panel is read-only context; no trading or linking to other markets from it.

## Key Decisions

- **Channel history source: live YouTube API** — Fetching recent channel videos directly from the YouTube API gives the richest, most up-to-date context. Caching strategy (e.g., short-lived server-side cache or stored in DB) is a planning decision.
- **View/like trajectory from `youtubePolls`** — This data is already collected; displaying it requires no new polling infrastructure.
- **Milestone target as reference line** — Overlaying the target on the stats chart is low cost and directly answers "how far has the video gotten?" at a glance.

## Dependencies / Assumptions

- The YouTube Data API is already integrated (a cron job polls it); channel history fetch must work within the same API quota.
- `videoMetadata` JSONB column needs to be extended to store `description` and `channelId` to enable R2 and R3. Either way, existing markets without this data need a backfill path.
- The channel ID is required to make the YouTube API call for channel history (R3).
- The `youtubePolls` table may have sparse data for new markets; the UI should handle the empty-state gracefully.

## Outstanding Questions

### Resolve Before Planning

_(none — product behavior and scope are clear)_

### Deferred to Planning

- [Affects R3][Technical] How should channel history be cached/stored to avoid hitting YouTube API quota on every page load? Options: short-lived in-memory cache, DB table, or ISR.
- [Affects R2, R4][Technical] Should `description` and `channelId` be added to the existing `videoMetadata` JSONB column or stored as separate columns? Requires a migration for existing rows.
- [Affects R3][Needs research] Does the current YouTube API key/quota allow channel video list calls, or does a new API scope need to be enabled?
- [Affects R4][Technical] What is the right responsive layout for the Video Intelligence section — tab-based (Description / Stats / Channel History) or stacked sections?

## Next Steps

→ `/ce:plan` for structured implementation planning
