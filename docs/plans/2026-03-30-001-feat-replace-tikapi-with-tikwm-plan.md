---
title: Replace TikAPI SDK with TikWM free HTTP API
type: feat
status: completed
date: 2026-03-30
---

# Replace TikAPI SDK with TikWM free HTTP API

## Overview

Replace the paid `tikapi` npm SDK with a free, no-key HTTP call to TikWM (`tikwm.com/api`). `TIKAPI_KEY` is already absent from `.env.local`, meaning every TikTok stat fetch currently throws `"TIKAPI_KEY not configured"`. This is a live breakage — the fix is urgent.

Only `src/lib/tiktok.ts` changes. All callers (cron, oracle, admin actions) are untouched because the `TikTokStats` interface and exported function signatures stay identical.

## Proposed Solution

Swap `api.public.video({ id: videoId })` for a `fetch()` to TikWM's video endpoint, map the response fields to the existing `TikTokStats` shape, and remove the `tikapi` package.

### TikWM API

```
GET https://www.tikwm.com/api/?url=https://www.tiktok.com/@_/video/{videoId}
```

No API key. Response:
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "id": "7123456789012345678",
    "title": "video description/caption",
    "cover": "https://p16-sign.tiktokcdn-us.com/...",
    "play_count": 12345,
    "digg_count": 456,
    "comment_count": 78,
    "share_count": 90,
    "create_time": 1700000000,
    "author": {
      "unique_id": "username",
      "nickname": "Display Name"
    }
  }
}
```

### Field Mapping

| TikWM field | TikTokStats field | Notes |
|---|---|---|
| `data.play_count` | `viewCount` | number |
| `data.digg_count` | `likeCount` | number |
| `data.comment_count` | `commentCount` | number |
| `data.share_count` | `shareCount` | number |
| `data.create_time` | `createdAt` | Unix seconds → `new Date(t * 1000).toISOString()` |
| `data.author.nickname` | `creatorName` | |
| `data.author.unique_id` | `creatorId` | |
| `data.cover` | `thumbnailUrl` | validate against `TIKTOK_THUMBNAIL_RE` before use |
| `data.id` | `tikapiPostId` | same canonical video ID TikAPI returned — column name kept to avoid migration |

### Deleted/Private Video Detection

- `code !== 0` OR `data` is null/falsy → return `null` (same as current TikAPI behaviour)
- This propagates cleanly into polling (inserts `null` view/like counts) and admin UI (returns 404)

### Fetch Implementation Notes

1. **Timeout**: Use `AbortSignal.timeout(8000)` — consistent with YouTube fetch timeout in the codebase
2. **Response validation**: Check `res.ok` before calling `.json()`, throw on non-2xx
3. **Error throwing vs null return**: Return `null` for "video not found" (`code !== 0`); throw for network/parse errors — this preserves the existing caller contract in `poll-tiktok/route.ts`
4. **Rate limiting**: Keep the existing 1100ms inter-request delay in the cron route — TikWM's limits are undocumented and the delay is harmless
5. **Thumbnail validation**: TikWM returns CDN URLs like `p16-sign.tiktokcdn-us.com` — verify this matches `TIKTOK_THUMBNAIL_RE = /^https:\/\/[a-z0-9-]+\.tiktokcdn\.com\//`. If it doesn't match (US subdomain variant), update the regex to also accept `tiktokcdn-us.com`

## Implementation Steps

### 1. Update `src/lib/tiktok.ts`

```typescript
// Remove:
import TikAPI from "tikapi";
function getClient() { ... }

// fetchTikTokStatsById — new body:
export async function fetchTikTokStatsById(videoId: string): Promise<TikTokStats | null> {
  const url = `https://www.tikwm.com/api/?url=https://www.tiktok.com/@_/video/${videoId}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`TikWM HTTP ${res.status}`);
  const json = await res.json();
  if (json?.code !== 0 || !json?.data) return null; // deleted, private, not found, or API error
  const d = json.data;
  return {
    viewCount:    d.play_count    ?? 0,
    likeCount:    d.digg_count    ?? 0,
    commentCount: d.comment_count ?? 0,
    shareCount:   d.share_count   ?? 0,
    createdAt:    new Date((d.create_time ?? 0) * 1000).toISOString(),
    creatorName:  d.author?.nickname   ?? "",
    creatorId:    d.author?.unique_id  ?? "",
    thumbnailUrl: d.cover ?? "",
    tikapiPostId: d.id ?? videoId,
  };
}
```

Keep `extractTikTokVideoId()` and `isTikTokUrl()` exactly as-is (no API calls, pure logic).

### 2. Update `TIKTOK_THUMBNAIL_RE` in `src/lib/constants.ts`

TikWM returns CDN URLs on `tiktokcdn-us.com` (see example response above). Update the regex to accept both variants:
```typescript
TIKTOK_THUMBNAIL_RE = /^https:\/\/[a-z0-9-]+\.tiktokcdn(?:-us)?\.com\//;
```

### 3. Remove `tikapi` package

```bash
npm uninstall tikapi
```

### 4. Confirm no lingering `TIKAPI_KEY` references

```bash
grep -r "TIKAPI_KEY" src/
```
Should return nothing. `TIKAPI_KEY` is already absent from `.env.local`.

## Critical Files

| File | Change |
|---|---|
| `src/lib/tiktok.ts` | Full rewrite of `fetchTikTokStatsById()`; remove SDK import/client |
| `src/lib/constants.ts` | Extend `TIKTOK_THUMBNAIL_RE` for `-us` CDN variant |
| `package.json` | Remove `"tikapi": "^3.2.1"` |

## Files NOT Changing

- `src/app/api/cron/poll-tiktok/route.ts` — calls `fetchTikTokStatsById()`, contract unchanged
- `src/lib/actions/admin.ts` — calls `fetchTikTokStatsById()`, contract unchanged
- `src/app/api/admin/video-stats/route.ts` — contract unchanged
- `src/lib/oracle.ts` — reads `tiktokPolls`, no TikAPI dependency
- `src/db/schema.ts` — `tikapiPostId` column kept as-is (no migration needed)
- `src/types/market.ts` — `MarketData` unchanged

## Acceptance Criteria

- [ ] Pasting a TikTok video URL in the admin panel returns video stats (view count, thumbnail, creator name) without errors
- [ ] `tikapiPostId` is populated in the database on market creation
- [ ] `GET /api/cron/poll-tiktok` with correct `CRON_SECRET` returns `{ polled: N, skipped: M }` with no errors for active TikTok markets
- [ ] A deleted/private TikTok video URL returns a 404 response in the admin UI, not a 500
- [ ] `tikapi` does not appear in `package.json` or `node_modules`
- [ ] No `TIKAPI_KEY` reference in `src/`
- [ ] TypeScript build passes: `npm run build`

## Risks

- **TikWM availability**: Unofficial free service with no SLA. If it goes down, per-market errors are collected in the cron response and polling continues for other markets — no cascading failure.
- **TikWM rate limits**: Undocumented, but the existing 1100ms inter-request throttle provides ample headroom for any reasonable free-tier limit.
