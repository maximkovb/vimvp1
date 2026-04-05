---
date: 2026-04-05
topic: market-page-desktop-layout
---

# Market Page Desktop Layout Fix

## Problem Frame

On desktop, the market page (`/markets/[id]`) feels visually stretched and unbalanced. The TikTok video is squeezed into a narrow 325px left column while the trading interface sprawls across a wide right column. The buy/sell HUD is buried inside a nested inner grid rather than sitting naturally next to the video. This needs to be restored to a layout where the video is at its natural 9:16 aspect ratio and the buy/sell controls live in a clearly visible side column.

## Requirements

- R1. On desktop (lg breakpoint+), the market page top section displays: video on the left at its natural 9:16 aspect ratio, and a fixed-width HUD column on the right.
- R2. The video player retains its existing pause/play toggle (click-to-pause with play icon overlay) and mute/unmute button in the lower-right corner.
- R3. The HUD column contains, in order from top to bottom: current YES/NO odds display, the trade panel (buy), and — when the authenticated user holds a position — a sell section showing their position and a sell button.
- R4. The HUD column is sticky so it stays in view while the user scrolls down to the stats section.
- R5. Below the top section (full width), the charts/stats/recent trades content scrolls normally — this includes: view/like trajectory chart, price history chart, market details, and recent trades.
- R6. The creator card and video description remain accessible on the page (below the video in the left column, or moved to the full-width section below).
- R7. On mobile, the layout is unchanged — the existing BetSheet drawer and single-column scroll are preserved.

## Success Criteria

- On a 1280px+ desktop screen, the video is visibly taller relative to the page and properly proportioned at 9:16 — not cramped or squished.
- The buy/sell HUD is immediately visible without scrolling when a market page loads.
- Sell controls appear in the desktop HUD when a user holds a position (parity with the mobile BetSheet).
- No layout changes occur on mobile.

## Scope Boundaries

- Mobile layout is out of scope — no changes to BetSheet, BottomNav, or mobile feed.
- No design changes to the feed/discover page (FeedCard, DiscoverFeed).
- No new trading features — only layout changes and sell-on-desktop parity.
- Video player internals (TikTokEmbed logic, error handling, URL refresh) are unchanged.

## Key Decisions

- **Video left, HUD right**: Chosen over a centered-video overlaid HUD — cleaner separation, no occlusion of video content.
- **Sell in desktop HUD**: Sell functionality shown when user has a position, mirroring mobile BetSheet parity.
- **Stats below the fold**: Charts and recent trades move to a full-width section that the user scrolls to — keeps the above-fold view clean.

## Dependencies / Assumptions

- The sell section in the HUD reuses the existing `SellButton` component and position-fetch logic already present in `BetSheet`.
- The `MarketLiveData` component will need to be refactored to separate the HUD elements (odds + trade) from the stats elements (charts, details, trades), or the market page layout restructured to compose them separately.

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] What width should the video column be on desktop? The current 325px is too narrow — likely 340–380px maintaining 9:16, but exact value needs visual validation.
- [Affects R3][Technical] Should the sell section in the desktop HUD live inside `MarketLiveData` or be composed directly in the market page alongside `TradePanel`?
- [Affects R5][Technical] Should `MarketLiveData` be split into a HUD component and a stats component, or should the market page restructure how it composes the existing component?

## Next Steps

→ `/ce:plan` for structured implementation planning
