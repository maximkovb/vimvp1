---
title: "feat: Refactor market page desktop layout — natural video + side HUD"
type: feat
status: active
date: 2026-04-05
origin: docs/brainstorms/2026-04-05-market-page-desktop-layout-requirements.md
---

# feat: Refactor Market Page Desktop Layout — Natural Video + Side HUD

## Overview

The desktop market page (`/markets/[id]`) currently shows a narrow 325px TikTok video column beside a sprawling `flex-1` content column. The buy/sell panel is buried inside a nested inner grid far from the video. This plan restructures the page into three zones: a left video column at natural 9:16 size (~360px), a right sticky HUD column (status + odds + buy/sell), and a full-width stats section below the fold. Desktop sell functionality is added to the HUD, matching the mobile BetSheet experience.

## Problem Statement / Motivation

- The 325px video column feels cramped against the wide right side (~900px+ on a 1280px screen)
- The buy/sell panel is buried inside a nested `lg:grid-cols-3` inner grid (`MarketLiveData.tsx:191`) — spatially disconnected from the video
- Sell functionality exists on mobile (via `BetSheet`) but is absent on desktop — authenticated users cannot sell without using a mobile-width viewport
- The visual goal is "pre-UI overhaul" feel: video at natural size, HUD clearly adjacent

(See origin: `docs/brainstorms/2026-04-05-market-page-desktop-layout-requirements.md`)

## Proposed Solution

Three coordinated changes:

1. **Create `src/components/MarketHUD.tsx`** — a new client component that extracts the right-column HUD from `MarketLiveData`: live status bar, current odds, status-driven action slot (trade / halt countdown / resolution reveal / sign-in prompt), and a sell section for users who hold a position.

2. **Simplify `src/components/MarketLiveData.tsx`** — strip to stats-only: Toast (halt transition notification), VideoStatsChart, PriceChart, Market Details, Recent Trades. Remove the inner `lg:grid-cols-3` grid, the HUD-specific state (`userPosition`, `postTradeResult`, `showResolutionShare`), and the odds + action slot.

3. **Restructure `src/app/markets/[id]/page.tsx`** — new desktop layout:
   - SSR `h1` title above the two-column section (title is static — markets don't rename)
   - Left column (`lg:w-[360px] flex-shrink-0`): `TikTokEmbed` + creator card + video description
   - Right column (`flex-1`, sticky): `MarketHUD`
   - Full-width section below: `MarketLiveData` (stats only)

## Technical Considerations

- **SWR deduplication**: `MarketHUD` subscribes to `/api/markets/${marketId}` — the same key used by `MarketLiveData`. SWR deduplicates these into a single network request. No double-fetching.

- **Sell on desktop — position source**: `BetSheet` reads position from `marketData?.userPosition` via the shared SWR response. Before implementing sell in the HUD, verify whether the `/api/markets/[id]` endpoint includes `userPosition` for authenticated users on _active_ markets. If it does, use `market.userPosition` directly. If not, add a `getUserPosition(marketId)` call on mount in `MarketHUD` guarded by `session?.user && market.status === "active"` — mirroring the existing resolved-status fetch in `MarketLiveData.tsx:96–106`.

- **Chart resize (known gotcha)**: `VideoStatsChart` and `PriceChart` currently use `window.addEventListener("resize", ...)`. Charts moving from 2/3-width to full-width will render correctly on initial mount (static layout), but on viewport resize events they may freeze. Replace `window.resize` with `ResizeObserver` on the chart's container `div` ref in both components. Always call `observer.disconnect()` before `chart.remove()` in the cleanup. (Reference: `docs/solutions/integration-issues/lightweight-charts-v5-typescript-utctimestamp-integration.md`)

- **Sticky offset**: Current value is `top-20` (80px, `MarketLiveData.tsx:296`). In the new layout with the title sitting above the two-column section, `top-4` or `top-6` is likely more appropriate. Tune visually after first render.

- **Video column width**: Increasing from `lg:w-[325px]` to `lg:w-[360px]` gives a 640px tall video at 9:16 — a reasonable starting point on a 1080p display. Tune visually; the `paddingBottom: "177.78%"` ratio wrapper in `TikTokEmbed.tsx:82` is self-contained and will respond to any parent width change automatically.

- **State to move from `MarketLiveData` → `MarketHUD`**: `userPosition`, `postTradeResult`, `showResolutionShare`, `positionFetchedRef`, `handleTradeSuccess`, `handleRevealComplete`. The `ResolutionShareCard` portal moves with them (portals to `document.body` regardless of render location).

- **State to keep in `MarketLiveData`**: `lastFetched`, `prevValidating`, `prevStatusRef`, `toast` — all needed for the halt-transition Toast notification.

- **Mobile**: All structural changes are scoped to the `lg:` breakpoint or to new components. `BetSheet`, `DiscoverFeed`, `FeedCard`, and the mobile bottom nav are untouched.

- **Tailwind v4**: No `tailwind.config.js` — customizations live in `globals.css` via `@theme inline`. No new design tokens are required for this refactor.

## Files

| File | Change |
|---|---|
| `src/app/markets/[id]/page.tsx` | Restructure layout: h1 title above, two-column (video + HUD), stats below |
| `src/components/MarketLiveData.tsx` | Strip to stats-only (remove inner grid, HUD state, odds card, action slot) |
| `src/components/MarketHUD.tsx` | **New** — status bar + odds + action slot + sell section |
| `src/components/VideoStatsChart.tsx` | Replace `window.resize` with `ResizeObserver` |
| `src/components/PriceChart.tsx` | Replace `window.resize` with `ResizeObserver` |

Unchanged: `TikTokEmbed.tsx`, `TradePanel.tsx`, `SellButton.tsx`, `BetSheet.tsx`, `HaltCountdownBlock.tsx`, `ResolutionReveal.tsx`, `PostTradeShareCard.tsx`, `ResolutionShareCard.tsx`.

## Acceptance Criteria

- [ ] On `lg`+, video renders in left column at 9:16 aspect ratio, visibly wider than pre-refactor 325px
- [ ] Pause/play (click-to-pause with play icon overlay) and mute/unmute remain functional
- [ ] Right column HUD is visible without scrolling: status badge + countdown + last-updated + YES/NO odds + action slot
- [ ] Active market + signed-in user: TradePanel renders in HUD
- [ ] Active market + signed-in user + position held: SellButton renders below TradePanel in HUD
- [ ] Halted/resolving market: HaltCountdownBlock renders in HUD
- [ ] Resolved market: ResolutionReveal renders in HUD; ResolutionShareCard modal fires on reveal complete
- [ ] Unauthenticated user: sign-in prompt renders in HUD
- [ ] Toast notification fires on halt transition
- [ ] Stats section (VideoStatsChart, PriceChart, Market Details, Recent Trades) renders full-width below the two-column section
- [ ] Charts render at correct width and resize correctly on viewport change (ResizeObserver fix)
- [ ] Mobile (`< lg`): layout is single-column, BetSheet behavior unchanged

## Dependencies & Risks

- **`marketData.userPosition` availability for active markets**: Must verify `src/app/api/markets/[id]/route.ts` and `src/lib/market-fetcher.ts` before writing sell logic. If missing, a `getUserPosition` call is needed in `MarketHUD`.
- **State split risk**: Moving state from `MarketLiveData` to `MarketHUD` is low risk — the two components have distinct rendering concerns and the SWR cache is shared.
- **Two SWR subscribers to same key**: Standard SWR usage, but note that `mutate()` calls in `MarketHUD` (after a successful trade) will also refresh `MarketLiveData`'s data — which is desirable.

## Sources & References

- **Origin document:** [`docs/brainstorms/2026-04-05-market-page-desktop-layout-requirements.md`](../brainstorms/2026-04-05-market-page-desktop-layout-requirements.md)
  Key decisions carried forward: video-left/HUD-right layout, sell visible in desktop HUD, stats below the fold, mobile untouched.

### Internal References

- Market page layout: `src/app/markets/[id]/page.tsx:97–149`
- MarketLiveData inner grid: `src/components/MarketLiveData.tsx:191`
- MarketLiveData sticky sidebar: `src/components/MarketLiveData.tsx:296`
- MarketLiveData HUD state to extract: `src/components/MarketLiveData.tsx:90–130`
- TikTokEmbed 9:16 wrapper: `src/components/TikTokEmbed.tsx:82`
- SellButton (self-contained): `src/components/SellButton.tsx`
- BetSheet sell pattern: `src/components/BetSheet.tsx:54` (position from SWR), `src/components/BetSheet.tsx:123` (SellButton usage)
- ResizeObserver gotcha: `docs/solutions/integration-issues/lightweight-charts-v5-typescript-utctimestamp-integration.md`
