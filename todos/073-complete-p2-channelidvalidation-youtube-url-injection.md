---
status: pending
priority: p2
issue_id: "073"
tags: [code-review, security, api]
dependencies: []
---

# `channelId` and `uploadsPlaylistId` not validated before YouTube URL interpolation

## Problem Statement

`generateMarketSuggestion` interpolates `channelId` directly into a YouTube API URL with only `z.string().min(1)` validation. A malicious input like `UC123&key=attacker_key` could inject additional query parameters, overriding the `key=` parameter and causing the server to use the attacker's YouTube quota for the request. The `uploadsPlaylistId` returned from YouTube's own response is also used without format validation in the second fetch.

The constant `YOUTUBE_CHANNEL_ID_RE` already exists in `src/lib/constants.ts` for exactly this purpose — it is imported in `admin.ts` for thumbnail validation but not applied to `channelId`.

## Findings

- `src/lib/actions/admin.ts` line 218: `` `${YOUTUBE_API_BASE}/channels?...&id=${channelId}&key=${apiKey}...` ``
- `channelId` validated only as `z.string().min(1)` in `MarketSuggestionSchema`
- `uploadsPlaylistId` from API response used at line 230 in another fetch URL without format check
- `src/lib/constants.ts` exports `YOUTUBE_CHANNEL_ID_RE = /^UC[a-zA-Z0-9_-]{22}$/` — unused here
- `YOUTUBE_THUMBNAIL_RE` IS used at line 431 — the pattern exists and works, just not applied to channel IDs

## Proposed Solution

```typescript
// In generateMarketSuggestion, before the channelId URL:
import { YOUTUBE_CHANNEL_ID_RE } from "@/lib/constants";

if (!YOUTUBE_CHANNEL_ID_RE.test(channelId)) {
  // Fall back to algorithmic path — don't block market creation entirely
  return buildAlgorithmicResult(/* ... */);
}

// Validate uploadsPlaylistId from API response before use:
const YOUTUBE_PLAYLIST_ID_RE = /^UU[a-zA-Z0-9_-]{22}$/;
if (uploadsPlaylistId && !YOUTUBE_PLAYLIST_ID_RE.test(uploadsPlaylistId)) {
  uploadsPlaylistId = undefined; // skip the second fetch silently
}
```

Also apply `YOUTUBE_CHANNEL_ID_RE` validation in `MarketSuggestionSchema` in `market-suggestion/route.ts`:
```typescript
channelId: z.string().regex(/^UC[a-zA-Z0-9_-]{22}$/)
```

- **Effort**: Small
- **Risk**: Low — adds validation only; non-matching IDs fall back to algorithmic path

## Acceptance Criteria

- [ ] `channelId` validated against `YOUTUBE_CHANNEL_ID_RE` before URL interpolation in `generateMarketSuggestion`
- [ ] `channelId` validated in `MarketSuggestionSchema` in the API route
- [ ] `uploadsPlaylistId` from API response validated against playlist ID format before the second fetch
- [ ] Invalid `channelId` triggers algorithmic fallback rather than a hard error (preserves market creation)

## Work Log

- 2026-03-27: Identified during `/ce:review` — security-sentinel (P2-4)
