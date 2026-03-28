<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Market Creation

### Two-phase pipeline

1. **Phase 1 — Video stats** (`GET /api/admin/video-stats?url=<youtubeUrl>`)
   Returns: `{ videoId, title, thumbnail, channelTitle, channelId, description, viewCount, likeCount, publishedAt, categoryId? }`
   Fast (~500ms). No channel analytics yet.

2. **Phase 2 — Market suggestion** (`POST /api/admin/market-suggestion`)
   Auth: `Authorization: Bearer <CRON_SECRET>`
   Body: `{ videoId, title, channelId, channelTitle, publishedAt, categoryId?, viewCount, likeCount }`
   Returns: `{ contract, suggestedTitle, videoAgeHours, subscriberCount, channelAvgViews, duplicateWarning }`
   Slow (~5–15s — calls YouTube channel API + LLM). Includes calibrated contract recommendation.

3. **Create market** (`POST /api/markets`)
   Auth: `Authorization: Bearer <CRON_SECRET>`
   Body schema: see `src/app/api/markets/route.ts → CreateMarketSchema`

### Calibration fields for `POST /api/markets`

Including these fields enables the server-side floor guard (the same check the admin UI applies):
- `initialViewCount` — current view count at time of creation (for velocity projection)
- `channelAvgViews` — channel's mean views per recent video (from Phase 2)
- `videoAgeHours` — video age in hours at creation time (for velocity projection)

Omitting any of these degrades the floor guard to velocity-only with age=1h (weaker check).

### Draft vs. publish

- `publishImmediately: true` — publishes immediately (UI default)
- `publishImmediately: false` — creates a draft (API default). The `marketId` is returned in the
  201 response; use `GET /api/markets/[id]` to verify the draft was created.
  **Note:** There is no bearer-token route to promote a draft to active (see todo #072).
  Until that route exists, use `publishImmediately: true` if the agent should go live immediately.

All routes use `Authorization: Bearer <CRON_SECRET>`.

## Market Inspection

- `GET /api/markets/[id]` — returns full market state: `{ id, title, status, priceYes, priceNo,
  outcome, resolvesAt, resolvedAt, milestoneThreshold, priceHistory, recentTrades, pollHistory }`
  No auth required. Use to verify creation or monitor status/price changes.

- `GET /api/markets` — returns all active/halted/resolving markets + last 6 resolved.
  No auth required. Response: `{ active: [...], resolved: [...] }`
