---
title: "fix: Video embed not showing on market page"
type: fix
status: active
date: 2026-04-02
---

# fix: Video embed not showing on market page

## Overview

When a user navigates to a market detail page (`/markets/[id]`), no TikTok video embed appears. The `TikTokEmbed` component is rendered unconditionally but the video is silently blocked by the browser.

## Problem Statement

Two compounding issues cause the embed to fail:

### 1. Missing `media-src` CSP directive (primary cause)

`next.config.ts` defines a Content Security Policy with `default-src 'self'` but **no `media-src` directive**. When `videoMetadata.playUrl` is present, `TikTokEmbed` renders a `<video src="https://v19-webapp.tiktok.com/...">` element. The browser enforces `default-src 'self'` for media, silently blocks the cross-origin URL, and fires `onError`.

The `onError` handler at `src/components/TikTokEmbed.tsx:16` calls `/api/tiktok/${videoId}/play-url` to refresh the URL, but the refreshed URL is from the same TikTok CDN family and is also blocked — the component is stuck in a broken `<video>` state with no visible content.

**Current CSP (next.config.ts:22-31):**
```
default-src 'self'
script-src 'self' 'unsafe-inline' 'unsafe-eval'
style-src 'self' 'unsafe-inline'
img-src 'self' https://*.tiktokcdn.com data: blob:
frame-src https://www.tiktok.com          ← allows iframe fallback
connect-src 'self'                        ← allows the API refresh call
font-src 'self' data:
                                          ← media-src MISSING
```

### 2. `onError` refresh never falls back to iframe (secondary cause)

When `onError` fires and the play-url API returns a fresh URL, `setCurrentPlayUrl(data.playUrl)` keeps rendering `<video>` — which is again blocked. There is no path to fall through to the `<iframe>` fallback even when all direct-play attempts fail. The iframe path via `https://www.tiktok.com/embed/v2/${videoId}` **is** covered by `frame-src` and would work.

## Affected Files

- `next.config.ts:22-31` — CSP headers
- `src/components/TikTokEmbed.tsx:16-30` — `onError` / refresh logic

## Proposed Solution

### Fix 1 — Add `media-src` to CSP (`next.config.ts`)

Add a `media-src` directive that covers TikTok's video CDN hostnames (the same family already allowed for images):

```
media-src 'self' https://*.tiktok.com https://*.tiktokv.com https://*.tiktokcdn.com https://*.tiktokcdn-us.com
```

This unblocks the `<video>` element for all markets that have a stored `playUrl`.

### Fix 2 — Fall back to iframe if refresh also fails (`TikTokEmbed.tsx`)

In `handleVideoError`, if the `/api/tiktok/${videoId}/play-url` request fails or returns no URL, set `currentPlayUrl` to `null` so the component falls through to the `<iframe>` fallback:

```typescript
// src/components/TikTokEmbed.tsx
async function handleVideoError() {
  if (refreshing) return;
  setRefreshing(true);
  try {
    const res = await fetch(`/api/tiktok/${videoId}/play-url`);
    if (res.ok) {
      const data = await res.json();
      setCurrentPlayUrl(data.playUrl ?? null);
    } else {
      setCurrentPlayUrl(null); // fall back to iframe
    }
  } catch {
    setCurrentPlayUrl(null); // fall back to iframe
  } finally {
    setRefreshing(false);
  }
}
```

## Acceptance Criteria

- [ ] Navigating to `/markets/[id]` for a market with a stored `playUrl` shows the TikTok video playing in the `<video>` element
- [ ] No CSP violation errors appear in the browser console for media loads
- [ ] If `playUrl` is absent or null, the TikTok `<iframe>` embed renders instead
- [ ] If the direct video URL fails and the refresh API also fails, the component falls back to the `<iframe>` embed rather than showing a blank area

## Implementation Notes

- TikWM `playUrl` values are CDN-signed URLs that expire ~24h. The `onError` → refresh flow (`/api/tiktok/[videoId]/play-url`) handles expiry; this fix ensures the fresh URL can actually load.
- The `frame-src https://www.tiktok.com` directive already in the CSP covers the iframe fallback path — no change needed there.
- Older markets where `videoMetadata` is null or `playUrl` was never stored already fall through to the iframe and should work once Fix 1 is in place (they were never blocked, but worth verifying).

## Sources

- `next.config.ts:22-31` — CSP header configuration
- `src/components/TikTokEmbed.tsx` — full component
- `src/app/markets/[id]/page.tsx:107-112` — `TikTokEmbed` usage
- `src/app/api/tiktok/[videoId]/play-url/route.ts` — refresh endpoint
