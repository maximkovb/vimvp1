---
title: "fix: Replace TikTok interactive embed with clean video-only player"
type: fix
status: active
date: 2026-04-01
---

# fix: Replace TikTok interactive embed with clean video-only player

## Overview

When a user clicks into a market, the video area currently loads `https://www.tiktok.com/embed/v2/{videoId}` in an iframe. This renders the **full TikTok interactive shell** — including comments, like/share buttons, creator profile, and follow CTA — inside the Virality UI. The goal is to replace this with a clean, distraction-free video player showing only the video itself, consistent with how apps like spike.app present TikTok content.

## Problem Statement

`TikTokEmbed.tsx` uses TikTok's official oEmbed iframe endpoint (`/embed/v2/`). This endpoint has no supported parameters to hide its interactive chrome, and cross-origin iframe CSS hacks are blocked by the browser. The result is that users see TikTok's full product UI nested inside the Virality market detail page, which:

- Looks visually broken / unprofessional
- Invites users to interact with TikTok (comment, follow, leave the page)
- Competes visually with Virality's own trading and stats interface

## Proposed Solution

Replace the TikTok oEmbed iframe with an HTML5 `<video>` element fed by a direct MP4 URL from TikWM.

TikWM (`tikwm.com/api/`) — already integrated in `src/lib/tiktok.ts` — returns `data.play` (watermarked CDN MP4) and `data.hdplay` (watermark-free HD MP4) in the same API call that already populates view/like counts. These URLs can be used directly in a `<video>` element for a native, chrome-free playback experience.

### Approach

1. **Extend `fetchTikTokStatsById`** in `src/lib/tiktok.ts` to also capture `data.play` (and optionally `data.hdplay`) alongside the existing stats fields.

2. **Store `playUrl` in `videoMetadata`** — the `video_metadata` JSONB column in the `markets` table already holds `{ title, thumbnail, channelTitle, ... }`. Add `playUrl: string | null` to this JSONB blob and populate it during market creation (in `src/lib/actions/admin.ts` where `fetchTikTokStatsById` is called and results are written to DB).

3. **Create a `/api/tiktok/[videoId]/play-url` route** as a fallback. TikWM CDN URLs are time-limited (typically ~24h). The market detail page's server component can pass the stored `playUrl` down; if it's expired or missing, the client can re-fetch via this route. The route calls `fetchTikTokStatsById` and returns only the `playUrl`.

4. **Rewrite `TikTokEmbed.tsx`** to accept an optional `playUrl` prop. If provided, render a `<video>` element. If missing (old markets without a stored URL), fall back to the existing iframe as a safety net.

5. **Update the market detail page** (`src/app/markets/[id]/page.tsx`) to pass `videoMetadata.playUrl` to `TikTokEmbed`.

### Simpler Alternative (Rejected)

Using undocumented query params on TikTok's embed URL (`?hide_caption=1&hide_owner=1`) can suppress *some* UI elements but does not remove the interactive chrome (comments, likes, profile bar). These params are fragile, undocumented, and TikTok can break them at any time. Not viable for a production feature.

## Technical Considerations

- **TikWM URL expiry**: `data.play` URLs are CDN-signed and expire (~24 hours). Storing them in DB is useful for page-load performance but requires a refresh mechanism. The `/api/tiktok/[videoId]/play-url` API route handles this transparently — the client calls it if the `<video>` element emits an error event.
- **CORS**: TikWM CDN URLs are served with permissive CORS headers — they are embeddable in `<video>` tags cross-origin.
- **Autoplay**: HTML5 video autoplay requires `muted` attribute in most browsers. The `<video>` element should include `autoPlay muted loop playsInline` for TikTok-style behavior.
- **Aspect ratio**: Current wrapper uses `paddingBottom: 177.78%` (9:16) — this stays correct for a `<video>` element too.
- **No DB migration needed**: `videoMetadata` is already JSONB; adding `playUrl` to its shape requires no schema change.
- **TypeScript**: Update the `VideoMetadata` type in `src/types/market.ts` to include `playUrl?: string | null`.

## Acceptance Criteria

- [ ] Clicking into any market shows only the TikTok video — no TikTok comments, likes, profile bar, or follow button visible
- [ ] Video autoplays muted and loops (matching spike.app UX)
- [ ] Thumbnail is shown while video loads (use `poster={videoMetadata.thumbnail}`)
- [ ] Markets created after this change have `playUrl` stored in `videoMetadata`
- [ ] Markets without a stored `playUrl` (legacy) still render without error (falls back to fetching via `/api/tiktok/[videoId]/play-url`)
- [ ] The `TikTokEmbed` component no longer renders a TikTok iframe for any market
- [ ] TypeScript build passes with no errors

## Files to Change

| File | Change |
|------|--------|
| `src/lib/tiktok.ts` | Add `playUrl: string` to `TikTokStats` interface; capture `d.play` in `fetchTikTokStatsById` |
| `src/types/market.ts` | Add `playUrl?: string \| null` to `VideoMetadata` type |
| `src/components/TikTokEmbed.tsx` | Rewrite to render `<video>` when `playUrl` prop is provided; keep iframe as fallback |
| `src/app/markets/[id]/page.tsx` | Pass `videoMetadata?.playUrl` to `<TikTokEmbed>` |
| `src/lib/actions/admin.ts` | Persist `playUrl` from `fetchTikTokStatsById` result into `videoMetadata` on market creation |
| `src/app/api/tiktok/[videoId]/play-url/route.ts` | New route — calls `fetchTikTokStatsById` and returns `{ playUrl }` |

## MVP Implementation Sketch

### src/lib/tiktok.ts (partial)

```typescript
export interface TikTokStats {
  // ... existing fields ...
  playUrl: string;   // d.play — watermarked MP4, CDN-signed (~24h expiry)
}

// Inside fetchTikTokStatsById, add:
playUrl: d.play ?? "",
```

### src/components/TikTokEmbed.tsx

```tsx
"use client";

interface TikTokEmbedProps {
  videoId: string;
  title?: string;
  playUrl?: string | null;
  thumbnail?: string | null;
}

export function TikTokEmbed({ videoId, title, playUrl, thumbnail }: TikTokEmbedProps) {
  // 9:16 aspect ratio wrapper — unchanged
  return (
    <div className="relative w-full" style={{ paddingBottom: "177.78%" }}>
      {playUrl ? (
        <video
          src={playUrl}
          poster={thumbnail ?? undefined}
          autoPlay
          muted
          loop
          playsInline
          title={title ?? "TikTok video"}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        // Fallback: legacy iframe for markets without stored playUrl
        <iframe
          src={`https://www.tiktok.com/embed/v2/${videoId}`}
          title={title ?? "TikTok video"}
          className="absolute inset-0 w-full h-full"
          allow="autoplay; encrypted-media"
          allowFullScreen
        />
      )}
    </div>
  );
}
```

### src/app/api/tiktok/[videoId]/play-url/route.ts

```typescript
import { fetchTikTokStatsById } from "@/lib/tiktok";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: { videoId: string } }
) {
  const stats = await fetchTikTokStatsById(params.videoId);
  if (!stats?.playUrl) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ playUrl: stats.playUrl });
}
```

## Dependencies & Risks

- **TikWM reliability**: TikWM is a free, unofficial API with no SLA. If it becomes unavailable, `playUrl` cannot be fetched. The iframe fallback mitigates complete breakage for legacy markets.
- **TikWM ToS**: Using `data.play` URLs for playback in your own app is technically outside TikTok's official developer terms (TikWM is unofficial). This is the same risk the app already accepts for using TikWM for stats. For a production launch, consider whether official TikTok Developer API access is needed.
- **URL expiry on page load**: If a user opens a market page where `videoMetadata.playUrl` was stored more than ~24h ago, the video element will fail to load. The client-side error handler should call `/api/tiktok/[videoId]/play-url` to get a fresh URL. This requires a small client-side error recovery pattern in `TikTokEmbed`.

## Sources & References

- Current embed component: `src/components/TikTokEmbed.tsx:10-16`
- TikWM fetch function: `src/lib/tiktok.ts:54-74`
- Market detail page (embed usage): `src/app/markets/[id]/page.tsx`
- VideoMetadata type: `src/types/market.ts`
- TikTok platform pivot requirements (R7 context): `docs/brainstorms/2026-03-31-tiktok-only-platform-pivot-requirements.md`
