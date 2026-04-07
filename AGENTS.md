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
  `pollHistory` is an array of `{ viewCount, likeCount, polledAt }` entries.
  No auth required. Use to verify creation or monitor status/price changes.

- `GET /api/markets` — returns all active/halted/resolving markets + last 6 resolved.
  No auth required. Response: `{ active: [...], resolved: [...] }`

- `GET /api/leaderboard` — returns top 100 traders ranked by `totalValue`.
  No auth required. Response: array of `{ rank, name, balance, openPositionsValue, totalValue }`.

## Cron / Admin Endpoints

- `GET /api/cron/resolve-markets` — triggers bulk market resolution for all markets past
  their `resolvesAt` time.
  Auth: `Authorization: Bearer <CRON_SECRET>`

## User / Portfolio Endpoints

> **Agent limitation:** The following endpoints use **session cookie auth** (NextAuth
> `auth()`) and cannot be called with a Bearer token. Agents cannot access them directly —
> they are browser-only (session cookie set by the sign-in flow is required).

- `GET /api/portfolio` — auth: **session cookie only** (not bearer).
  Returns: `{ balance, openValue, totalValue, loginStreak, positions, recentTrades }`
  Each position includes: `positionId, marketId, marketTitle, marketStatus, outcome, shares,
  avgCostBasis, currentPrice, markToMarket, pnl`.
  Each recent trade includes: `id, marketId, marketTitle, outcome, shares, cost, priceBefore,
  priceAfter, createdAt`.

- `GET /api/balance` — auth: **session cookie only** (not bearer).
  Returns: `{ balance, loginStreak, lastLoginReward }`

## Trading

### `POST /api/trades`

Auth: `Authorization: Bearer <CRON_SECRET>`

Buy or sell shares on behalf of the agent user (`AGENT_USER_ID` env var — must be set to the ID
of a pre-created user row in the DB, or all requests return 501).

**Buy shares** (spend coins, receive shares):
```json
{ "action": "buy", "marketId": "<id>", "outcome": 0, "amount": 100 }
```
`outcome`: `0` = YES, `1` = NO. `amount`: coins to spend (min 1).
Response: `{ "success": true, "shares": 12.34, "cost": 99.98 }`

**Sell shares** (return shares, receive coins):
```json
{ "action": "sell", "marketId": "<id>", "outcome": 0, "shares": 5.0 }
```
Response: `{ "success": true, "refund": 48.20 }`

Error codes: `400` validation / trade too small / insufficient shares, `402` insufficient balance,
`404` market or user not found, `409` market not active / no position / concurrent trade retry exhausted,
`501` `AGENT_USER_ID` not configured.

### `GET /api/markets/[id]/quote`

No auth required. Returns a price quote for a hypothetical buy.

Query params: `?outcome=0&amount=100` (both required; outcome must be 0 or 1; amount must be positive).

Response:
```json
{
  "shares": 12.34,
  "cost": 99.98,
  "avgPrice": 0.81,
  "priceImpact": 0.03,
  "currentPrice": 0.79,
  "newPrice": 0.82
}
```

Error codes: `400` invalid/missing params, `404` market not found, `409` market not active.
