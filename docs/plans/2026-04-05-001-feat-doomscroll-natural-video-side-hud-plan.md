---
title: "feat: Doomscroll Natural Video + Desktop Side HUD"
type: feat
status: active
date: 2026-04-05
origin: docs/brainstorms/2026-04-05-doomscroll-video-layout-requirements.md
---

# feat: Doomscroll Natural Video + Desktop Side HUD

## Overview

The doomscroll feed (`FeedCard`) currently shows a static thumbnail stretched to fill the full viewport (`object-cover`), distorting the video's natural 9:16 aspect ratio on desktop. The buy/sell UI is a bottom overlay that requires a tap to open `BetSheet`. This plan:

1. Replaces the static `<Image>` with an actual `<video>` player (with play/pause + mute controls) on both mobile and desktop
2. Introduces a desktop two-column layout: 9:16 video on the left, persistent buy/sell side HUD on the right
3. Keeps the mobile full-bleed layout unchanged — full-screen video, bottom YES/NO overlay, tap-to-open `BetSheet`

The existing `TikTokEmbed` component already implements the video player with all required controls. The existing `TradePanel` component is the side HUD. The market detail page (`/markets/[id]`) already uses the two-column pattern to reference. The implementation is primarily plumbing new data through existing types and restructuring `FeedCard`'s layout.

## Problem Statement / Motivation

On desktop, the feed feels visually broken — thumbnails are cropped and stretched with no video playback. The buy/sell flow requires a tap to open a bottom sheet even on large screens where a persistent side panel is natural. The goal is parity with the market detail page experience, applied to the scrollable feed context.

## Proposed Solution

Three-file change across two phases:

**Phase 1 — Data wiring:** `videoId`, `playUrl`, and `creatorId` are already in the database (`markets.videoId` + `videoMetadata` JSONB) and the home page query already fetches them. They just aren't threaded through the `FeedMarket` interface or `FeedCard` props. Add them.

**Phase 2 — FeedCard layout restructure:**
- On mobile (`lg:hidden`): replace `<Image>` with a full-bleed `<video>` element (`object-cover w-full h-full`, `autoPlay muted loop playsInline`). Keep the existing gradient overlay, YES/NO buttons, and `onTap` → `BetSheet` flow. Add a mute toggle button (same icon components already in `TikTokEmbed`). Click-to-pause as a touch event on the video element.
- On desktop (`hidden lg:flex`): render a two-column layout: `[9:16 TikTokEmbed] + [side HUD panel]`. Video column is `lg:w-[325px] flex-shrink-0` (matching the market detail page). Side HUD contains market title, creator, progress ring, and `TradePanel`. The `BetSheet` and bottom YES/NO buttons are `lg:hidden` — they are not shown on desktop.

## Technical Considerations

### Files to Change

| File | Change |
|------|--------|
| `src/components/DiscoverFeed.tsx` | Extend `FeedMarket` interface; pass `videoId`, `playUrl`, `creatorId` to `FeedCard` |
| `src/components/FeedCard.tsx` | Add video props; restructure for mobile-video + desktop two-column layout; import `TradePanel` |
| `src/components/TikTokEmbed.tsx` | **No changes** — used as-is for the desktop video column |
| `src/components/TradePanel.tsx` | **No changes** — used as-is for the side HUD |
| `src/components/BetSheet.tsx` | **No changes** — stays as mobile-only, not invoked on desktop |
| `src/app/page.tsx` | **No changes** — query already fetches full `videoMetadata` JSONB |

### Data Wiring Detail

`DiscoverFeed.tsx` `FeedMarket` interface (line 10) needs:
```ts
videoId: string;
videoMetadata: {
  title: string;
  thumbnail: string;
  channelTitle: string;
  playUrl?: string | null;   // add
  creatorId?: string | null; // add
} | null;
```

`FeedCard` props need the same additions. The home page passes raw `markets` rows to `DiscoverFeed` — `market.videoId` and `market.videoMetadata?.playUrl` are already present in the server data.

### Mobile Video Element

Replace the `<Image>` in `FeedCard` with:
```tsx
<video
  key={playUrl ?? videoId}
  src={playUrl ?? undefined}
  poster={thumbnailSrc ?? undefined}
  autoPlay
  muted
  loop
  playsInline
  className="absolute inset-0 w-full h-full object-cover"
  onClick={togglePause}
  onError={handleVideoError}   // refresh playUrl via /api/tiktok/[videoId]/play-url
/>
```

If `playUrl` is null (legacy market), fall back to the existing static `<Image>` thumbnail — `TikTokEmbed`'s fallback goes to iframe, but for full-bleed mobile we only need the poster/thumbnail fallback since the iframe doesn't work in a full-viewport `object-cover` context.

### Desktop Video Column

Reuse `TikTokEmbed` directly:
```tsx
<TikTokEmbed
  videoId={videoId}
  title={title}
  playUrl={playUrl}
  thumbnail={thumbnailSrc}
  creatorId={creatorId}
/>
```

This gives the 9:16 `paddingBottom: 177.78%` wrapper, play/pause click, mute toggle, and URL-expiry refresh — all already built.

Note: `TikTokEmbed` renders a "View on TikTok" link below the video. This should be hidden in the feed context. Wrap in a div with `[&>a]:hidden` or pass a prop — simplest approach is a `showLink={false}` prop added to `TikTokEmbed`, defaulting to `true` to preserve existing behavior on the market detail page.

### Desktop Side HUD

```tsx
{/* Desktop only */}
<div className="hidden lg:flex flex-col gap-4 w-[360px] flex-shrink-0 overflow-y-auto max-h-screen py-8">
  {/* Creator + title */}
  <div>
    <p className="text-sm text-muted">@{channelTitle}</p>
    <p className="font-semibold leading-snug mt-1">{title}</p>
  </div>

  {/* Progress ring + milestone */}
  <div className="flex items-center gap-3">
    <ProgressRing current={currentCount} target={milestoneThreshold} />
    <p className="text-xs text-muted">
      Target: {Number(milestoneThreshold).toLocaleString()} {questionType}
    </p>
  </div>

  {/* Trade panel — only when active */}
  {isTrading && (
    <TradePanel
      marketId={id}
      prices={[priceYes, priceNo]}
    />
  )}

  {/* Halted / resolving badge */}
  {!isTrading && (
    <div className="px-3 py-2 rounded-lg bg-amber-500/10 text-amber-400 text-sm text-center">
      {status === "resolving" ? "Resolving…" : "Trading halted"}
    </div>
  )}
</div>
```

`ProgressRing` is already defined in `FeedCard.tsx` — it stays in the same file, just referenced from both the mobile overlay and the desktop HUD.

### Desktop Two-Column Wrapper in FeedCard

```tsx
{/* Desktop layout */}
<div className="hidden lg:flex flex-row h-full items-center justify-center gap-8 px-12 bg-background">
  {/* Left: 9:16 video */}
  <div className="w-[325px] flex-shrink-0">
    <TikTokEmbed ... showLink={false} />
  </div>
  {/* Right: side HUD */}
  <div className="flex flex-col gap-4 w-[360px] ...">
    ...
  </div>
</div>

{/* Mobile layout — unchanged except <Image> → <video> */}
<div className="lg:hidden relative w-full h-full">
  ...existing mobile layout...
</div>
```

### Breakpoint

Use `lg:` (1024px) consistently — all two-column patterns in the codebase use `lg:` for the desktop split. `md:` is reserved for the sidebar/bottom-nav shell transition.

### BetSheet on Desktop

`BetSheet` continues to render in `DiscoverFeed`, but its trigger (`onTap` / YES/NO button click) is only reachable on mobile (`lg:hidden`). No code changes to `BetSheet` needed. The `containerRef` scroll-lock pattern remains intact for mobile.

## System-Wide Impact

- **Interaction graph:** `FeedCard` gains a direct `TradePanel` render on desktop. `TradePanel` calls `buyShares` server action — no change to that path. `BetSheet` SWR-fetches live prices on mobile; the desktop HUD uses static prices from page load (same as the market detail page initial load). This is acceptable — `TradePanel` shows the `previewTrade` result which reflects current prices.
- **State lifecycle risks:** None. The trade path (`buyShares`) is unchanged. No new DB calls.
- **Mobile unchanged:** The `lg:hidden` / `hidden lg:flex` split ensures mobile renders exactly what it does today.
- **`TikTokEmbed` on market detail page:** The new `showLink` prop defaults to `true` — no behavior change on the market detail page.

## Acceptance Criteria

- [ ] **R1.** On desktop (≥1024px), each feed card is two-column: video on the left at natural 9:16, side HUD on the right. No stretching or distortion.
- [ ] **R2.** On mobile (<1024px), layout is visually identical to today: full-viewport, bottom YES/NO buttons, tap opens `BetSheet`. No regression.
- [ ] **R3.** The video in the feed plays the actual video (not just a static thumbnail) with: click/tap to toggle pause, visible mute/unmute button. Falls back to thumbnail `<Image>` if `playUrl` is null.
- [ ] **R4.** On desktop, `TradePanel` is visible in the side HUD without any tap required. An active-market user can place a YES or NO trade directly from the feed.
- [ ] **R5.** `FeedMarket` type and `FeedCard` props include `videoId`, `videoMetadata.playUrl`, and `videoMetadata.creatorId`. No DB query changes needed.
- [ ] The "View on TikTok" link is hidden in the feed context but still present on the market detail page.
- [ ] Halted/resolving markets show a status badge in the side HUD instead of `TradePanel`.
- [ ] `ProgressRing` appears in both the mobile top-right overlay and the desktop side HUD.

## Success Metrics

- Desktop feed shows real video (not thumbnail) at correct 9:16 aspect ratio
- No visible stretching or letterboxing outside the video column on desktop
- Play/pause and mute controls are functional in the feed
- Trade can be placed from desktop feed without opening a sheet

## Dependencies & Risks

- **`playUrl` expiry:** TikWM CDN URLs expire in ~24 hours. The `handleVideoError` pattern in `TikTokEmbed` (refetch from `/api/tiktok/[videoId]/play-url`) must be replicated for the mobile full-bleed video element. This endpoint already exists.
- **Markets without `playUrl`:** Legacy markets may have `null` for `playUrl`. Fallback to static `<Image>` thumbnail on mobile (already the current behavior). On desktop, `TikTokEmbed` falls back to iframe — acceptable.
- **`TikTokEmbed` "View on TikTok" link:** Easiest to suppress with a `showLink` prop. Low risk — one optional boolean prop, default `true`.
- **`TradePanel` requires authenticated session for trades** but renders fine for anonymous users — `buyShares` returns `{ error: "Not authenticated" }` on submit. No auth check needed in the HUD render path.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-05-doomscroll-video-layout-requirements.md](../brainstorms/2026-04-05-doomscroll-video-layout-requirements.md)
  Key decisions carried forward: (1) desktop two-column / mobile full-bleed split, (2) `TradePanel` as the side HUD component, (3) `TikTokEmbed` reused for desktop video column
- `src/components/FeedCard.tsx` — file being changed; current mobile layout
- `src/components/DiscoverFeed.tsx:10` — `FeedMarket` interface to extend
- `src/components/TikTokEmbed.tsx` — video player with play/pause + mute, 9:16 wrapper
- `src/components/TradePanel.tsx` — self-contained trade widget for side HUD
- `src/components/BetSheet.tsx` — mobile sheet; no changes, preserved as-is
- `src/app/markets/[id]/page.tsx:97-148` — two-column `flex flex-col lg:flex-row` + `lg:w-[325px]` pattern to match
- `src/components/MarketLiveData.tsx` — `lg:grid-cols-3` sticky right-column pattern for reference
- Prior plan: `docs/plans/2026-04-04-002-feat-mobile-first-doomscroll-ui-plan.md` — snap-scroll architecture, `vaul` container prop, iOS scroll-lock pattern
