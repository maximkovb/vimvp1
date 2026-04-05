---
date: 2026-04-05
topic: doomscroll-video-layout
---

# Doomscroll: Natural Video + Side HUD Layout

## Problem Frame

The current doomscroll feed (`FeedCard`) stretches a static thumbnail to fill the full viewport (`object-cover`), distorting the video's natural 9:16 aspect ratio on desktop. The buy/sell UI sits as a bottom overlay, requiring a tap to open `BetSheet`. The pre-overhaul experience had an actual video player with play/pause and mute controls. This work restores natural video sizing and moves the trading interface to a persistent side HUD on desktop.

## Requirements

- **R1.** On desktop, each doomscroll card renders the video at its natural 9:16 aspect ratio — not stretched to fill the viewport. The card layout is two-column: video on the left, buy/sell HUD on the right. The page background fills any remaining space.
- **R2.** On mobile, the current full-bleed layout is unchanged (video/thumbnail fills viewport, YES/NO buttons at bottom, tap to open BetSheet).
- **R3.** The video player in the feed plays the actual video (not just a static thumbnail), auto-plays muted on scroll into view, and supports: click/tap to toggle pause, and a visible mute/unmute button. This matches the behavior of the existing `TikTokEmbed` component.
- **R4.** On desktop, the side HUD is always visible (no tap required to reveal). It shows YES/NO prices and allows the user to place trades without leaving the doomscroll context.
- **R5.** The video data available to the doomscroll feed must include `videoId` and `playUrl` so the actual video can be played (currently `FeedCard` only receives `videoMetadata.thumbnail`).

## Success Criteria

- On desktop, the video is not distorted — it renders at 9:16.
- Play/pause and mute/unmute controls are present and functional in the doomscroll feed.
- A user can place a YES or NO trade on desktop without opening a bottom sheet.
- Mobile behavior is visually and functionally unchanged.

## Scope Boundaries

- Mobile layout is not changed.
- This does not affect the market detail page (`/markets/[id]`), which already works correctly.
- The end-grid (`FeedEndGrid`) is out of scope.

## Key Decisions

- **Desktop layout**: Two-column (video left, HUD right), matching the pattern of the market detail page.
- **Mobile layout**: Full-bleed unchanged — side HUD is desktop-only.

## Dependencies / Assumptions

- `playUrl` is stored in `videoMetadata` or retrievable via the existing `/api/tiktok/[videoId]/play-url` endpoint (as used by `TikTokEmbed`). If `playUrl` is not in the DB record, the feed server component must either include `videoId` so the client can fetch on error, or add `playUrl` to the DB query.

## Outstanding Questions

### Deferred to Planning

- [Affects R4][Technical] Should the desktop side HUD reuse `TradePanel`, `BetSheet` content, or `MarketLiveData`? Check what the market detail page uses and whether it can be extracted cleanly.
- [Affects R5][Needs research] Is `playUrl` stored in the `markets` table or only in `videoMetadata` JSON? Confirm what fields need to be added to the `FeedMarket` type and the home page query.

## Next Steps

→ `/ce:plan` for structured implementation planning
