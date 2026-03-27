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
   Body: `{ videoId, title, channelId, channelTitle, publishedAt, categoryId?, viewCount, likeCount }`
   Returns: `{ contract, suggestedTitle, videoAgeHours, subscriberCount, channelAvgViews, duplicateWarning }`
   Slow (~5–15s — calls YouTube channel API + LLM). Includes calibrated contract recommendation.
   **Note:** The `/api/admin/market-suggestion` route currently requires the core logic to be
   extracted from the session-gated server action before it will work. See the TODO in
   `src/app/api/admin/market-suggestion/route.ts`. Until then, use the server action directly
   from a browser session or supply contract parameters manually to `POST /api/markets`.

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

- `publishImmediately: true` — publishes immediately (what the admin UI always does)
- `publishImmediately: false` — creates a draft (API default). The admin UI does not expose this option, but agents can use it to stage markets for review.

All routes use `Authorization: Bearer <CRON_SECRET>`.
