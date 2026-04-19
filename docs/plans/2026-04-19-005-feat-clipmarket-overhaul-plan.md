---
title: "feat: Clipmarket Overhaul — Brand, Design System, and UX Redesign"
type: feat
status: active
date: 2026-04-19
origin: /tmp/clipmarket-design/clipmarket/project/Clipmarket.html
---

# feat: Clipmarket Overhaul — Brand, Design System, and UX Redesign

## Overview

Virality is being rebranded and redesigned as **Clipmarket**. The overhaul covers the full visual layer: design tokens, typography, logo, navigation, market detail layout, trade ticket, view trajectory chart, and mobile discover UX. No database schema, API routes, or auth logic changes.

The reference design is `Clipmarket.html` (extracted from the design bundle at the URL provided). The design introduces a cyan/orange YES/NO palette, Geist + JetBrains Mono typography, a Clipmarket conic-gradient logo, an Axiom-style dense metrics grid, a view-trajectory chart with goal line, a redesigned trade ticket with price buttons and payout breakdown, and a mobile discover-first doomscroll with a grid toggle.

## Problem Frame

The current Virality UI uses a blue accent, DM Sans, and a conventional layout that doesn't communicate the TikTok-native + trading-platform duality the product occupies. The design brief asks for: sleek content-first shell, trading ornaments only where they matter, and always-on data density (Axiom-style).

## Requirements Trace

- R1. Brand: rename "Virality" to "Clipmarket" everywhere user-visible (metadata, logo, sidebar, page title)
- R2. Design tokens: replace current CSS variables with the Clipmarket token set (cyan/orange YES/NO, dark bg hierarchy, ink shades, radius scale)
- R3. Typography: replace DM Sans with Geist + JetBrains Mono (monospace for numbers and data)
- R4. Logo: Clipmarket logomark (conic gradient square with "C" in mono, "clipmarket" wordmark)
- R5. Navigation: sidebar and bottom nav styled with new tokens and active-state cyan; sidebar gains Markets sub-menu
- R6. Desktop top bar: breadcrumb + LIVE indicator strip above main content
- R7. State badge: ON TRACK / AT RISK / BREAKING OUT visual update (green/orange/cyan palette)
- R8. View trajectory chart: static chart showing view count vs milestone goal, hover crosshair, full-24h canvas
- R9. Trade ticket: YES/NO as tall price-tile buttons (56px), payout breakdown summary card below amount
- R10. Market detail (desktop): 3-column layout — video + trade ticket left, center chart+stats, collapsible right rail with dense metrics
- R11. Mobile discover: doomscroll as primary view, view-toggle button (doomscroll ↔ grid), YES/NO split bar + sparkline in doomscroll HUD
- R12. Desktop discover: collapsible Live Markets right rail (default collapsed)

## Scope Boundaries

- No changes to database schema, API routes, or server actions
- No changes to admin market creation flow
- No changes to auth (Google OAuth, session middleware)
- No changes to cron jobs or resolution logic
- Leaderboard, Portfolio, and History pages receive token/typography updates only (no layout change in this pass)

### Deferred to Separate Tasks

- Leaderboard page visual redesign (table layout overhaul): separate PR
- Portfolio positions table redesign: separate PR
- Profile page redesign: separate PR
- Resolved markets page redesign: separate PR
- Tweaks panel / theme switcher (YES/NO color swatches, bg mode): post-MVP polish

## Context & Research

### Relevant Code and Patterns

- `src/app/globals.css` — current CSS variables and Tailwind config; all token changes land here
- `src/app/layout.tsx` — font import (DM Sans → Geist + Geist Mono), metadata title/description
- `src/components/AppShell.tsx` — layout shell; receives new desktop top bar slot
- `src/components/SidebarClient.tsx` — "Virality" text logo → ClipmarketLogo component
- `src/components/BottomNavClient.tsx` — active-state color update
- `src/lib/nav-items.tsx` — nav item icon definitions
- `src/components/TradePanel.tsx` — trade UI logic; YES/NO buttons and payout display are visual-only changes on top of existing LMSR math
- `src/components/FeedCard.tsx` — projection badge styling (`PROJECTION_BADGE` map); doomscroll HUD layout
- `src/components/VideoStatsChart.tsx` — lightweight-charts area series + milestone line; redesign to static-canvas style with goal line
- `src/components/MarketStatusBadge.tsx` — badge for market lifecycle states; distinct from projection badge
- `src/components/DiscoverFeed.tsx` — orchestrates doomscroll + FeedEndGrid; view-mode toggle wires in here
- `src/app/markets/[id]/page.tsx` — market detail layout; 3-column restructure happens here

### Institutional Learnings

- Next.js memory: `docs/solutions/` — three-layer cache requirement for live data routes (`force-dynamic`, `Cache-Control: no-store`, `fetch cache:no-store`). No new data routes in this plan, but note for any new server components introduced.
- Turbopack: never call `unref()` on `setInterval` in instrumentation hooks.
- `lightweight-charts` is already in the dependency tree (`"lightweight-charts": "^5.1.0"`).

### External References

- Geist font is available via `next/font/google` as `Geist` (sans) and `Geist_Mono` — use the same pattern as current `DM_Sans` import in `layout.tsx`.
- Design token source: `/tmp/clipmarket-design/clipmarket/project/styles/tokens.css` and `components/primitives.jsx` — treat these as the authoritative reference for all color/shape values.

## Key Technical Decisions

- **Token strategy**: Replace existing CSS custom properties in `globals.css` directly (not add alongside). The Tailwind `@theme inline` block maps new token names to Tailwind utilities. Old names (`--accent`, `--green`, `--red`) become `--yes` and `--no` in the new system. Update all Tailwind class references that hard-code `text-accent`, `bg-accent`, `text-green-*`, `text-red-*` to the new token utilities.
- **Font loading**: Import `Geist` and `Geist_Mono` from `next/font/google`. CSS variables `--font-sans` and `--font-mono` are set on `:root`. The `body` font-family rule reads `var(--font-sans)`.
- **ClipmarketLogo placement**: Implemented as a React component in `src/components/ClipmarketLogo.tsx`. Not inlined into sidebar — reusable for mobile top bar and future use.
- **StateBadge**: New component `src/components/StateBadge.tsx` wrapping the projection label display. `FeedCard.tsx` and `MarketHUD.tsx` switch from the inline `PROJECTION_BADGE` map to this component. The `MarketStatusBadge.tsx` (lifecycle states: active/resolved/etc.) remains separate and unchanged.
- **View trajectory chart**: `VideoStatsChart.tsx` is redesigned to be a static-range chart (full 24h canvas visible without scrolling). The goal line (milestone) is rendered as a horizontal dashed line at the target value. The chart uses `crosshair` mode for hover tooltip. The time range is fixed: `from = market creation time`, `to = resolvesAt`. This avoids the current UX problem where the goal is off-screen until zoomed out.
- **Trade ticket layout**: Visual-only change to `TradePanel.tsx`. The YES/NO outcome selector becomes two 56px-tall tiles showing the current price in cents (e.g., `62¢`). The existing payout math (`payoutYes`, `payoutNo`, `priceImpact`) feeds a new summary card below the amount input. Slider is removed in favor of direct number input + percentage chip row (10% / 25% / 50% / 75% / 100%).
- **Market detail 3-column (desktop)**: The `markets/[id]/page.tsx` layout changes from `flex-col lg:flex-row` (video left, HUD right) to a 3-column grid on `lg+`. Column 1: 9:16 video (340px fixed). Column 2 (flex-1): YES/NO price bar, trade ticket, view trajectory chart, resolution rules. Column 3 (320px, collapsible): dense metrics rail. Below all columns: `MarketLiveData`. The collapsible rail state lives in a `"use client"` wrapper component.
- **Mobile view toggle**: `DiscoverFeed.tsx` gains a `viewMode: 'scroll' | 'grid'` state (default `'scroll'`, persisted to `localStorage`). A toggle button (doomscroll icon vs grid icon) is rendered in the doomscroll top-bar area. In scroll mode, the existing doomscroll renders. In grid mode, `FeedEndGrid` renders (or the grid portion of the existing component). The `FeedEndGrid` currently appended at the bottom of the scroll feed is removed from the scroll view and becomes the exclusive grid view.
- **Desktop discover Live Markets rail**: New `LiveMarketsRail` component added to desktop discover feed layout. Starts collapsed (38px strip). State persists via `localStorage`. Fetches from the existing `GET /api/markets` response (already fetched by the page).

## Open Questions

### Resolved During Planning

- **Geist font availability**: Available in `next/font/google` as `Geist` and `Geist_Mono` — confirmed.
- **lightweight-charts in dep tree**: Yes, already at `^5.1.0` — no new dependency needed.
- **FeedEndGrid + view toggle relationship**: FeedEndGrid is the grid; in scroll mode it's hidden, in grid mode it's shown. The `sentinelRef` / `IntersectionObserver` that triggers FeedEndGrid visibility is removed or bypassed in grid-mode.

### Deferred to Implementation

- **CoinSlider removal**: The existing `CoinSlider` component is used in the current TradePanel. If the new trade ticket drops the custom slider entirely (% chips + text input only), CoinSlider may become unused. Verify before removing.
- **`--accent` Tailwind utility references**: A grep pass during implementation will reveal all places `text-accent`, `bg-accent`, `border-accent` etc. appear. The plan assumes they all migrate to `text-yes-ink`, `bg-yes-bg` etc., but implementer should verify edge cases.
- **Desktop TopBar breadcrumb data**: The breadcrumb needs to know the current page title. Implementation should determine whether this comes from a layout context, `usePathname`, or a layout-level `<title>` prop pattern.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Token map (old → new)**

| Old variable | New variable | Value |
|---|---|---|
| `--accent` | `--yes` (primary), or `--yes-ink` | `#22d3ee` |
| `--green` | `--ok` | `#4ade80` |
| `--red` | `--no` | `#f97316` |
| `--background` | `--bg-0` | `#0a0a0b` |
| `--card` | `--bg-1` | `#111113` |
| `--card-hover` | `--bg-3` | `#1d1d21` |
| `--border` | `--line` | `rgba(255,255,255,0.06)` |
| `--muted` | `--ink-3` | `#71717a` |
| `--foreground` | `--ink-0` | `#f4f4f5` |

**Desktop market detail column layout (lg+)**

```
┌────────────────────────────────────────────────────────┐
│ DesktopTopBar (breadcrumb · subtitle · LIVE)           │
├──────────────────────────────────┬─────────────────────┤
│ [340px] 9:16 video               │ [collapsible 320px] │
│ ─────────────────────────────── │ LiveMetricsRail     │
│ YES/NO price tiles + split bar  │   (toggle button)   │
│ Trade ticket (amount, %, payout)│                     │
│                                  │                     │
│ ViewTrajectoryChart (full-width col 2) ────────────── │
│ Resolution rules                                       │
└────────────────────────────────────────────────────────┘
```

**Mobile discover view toggle**

```
MobileTopBar [Clipmarket logo] [Feed⇄Grid icon]
  ├── viewMode=scroll → DiscoverFeed (doomscroll, existing)
  │     FeedCard HUD: [YES split bar] [sparkline] [62¢YES | 38¢NO]
  └── viewMode=grid  → FeedEndGrid (existing grid component)
```

## Implementation Units

- [ ] **Unit 1: Design Tokens + Typography + Brand Metadata**

**Goal:** Replace all CSS custom properties with the Clipmarket token set; swap font from DM Sans to Geist + Geist Mono; update page metadata.

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

**Approach:**
- In `globals.css`: replace `:root` block with new variables from `tokens.css` reference. Keep Tailwind `@theme inline` block but map new names (`--color-yes`, `--color-no`, `--color-bg-0` etc.). Add `.mono` / `.num` utility classes. Add `.card`, `.card-glass`, `.card-bordered` CSS classes. Add `.label`, `.label-sm` utility classes. Add `.live-dot` keyframe animation. Add `.btn`, `.btn-yes`, `.btn-no` base button styles.
- In `layout.tsx`: import `Geist` and `Geist_Mono` from `next/font/google`. Replace `DM_Sans` import and variable. Update `metadata` object: title `"Clipmarket — Predict TikTok's Next Hit"`, description updated. The `html` className uses the two new font variables.

**Patterns to follow:**
- Existing `DM_Sans` import pattern in `src/app/layout.tsx` — replicate with `Geist` / `Geist_Mono`

**Test scenarios:**
- Happy path: `body` element uses `var(--font-sans)` (Geist); numeric elements using `.mono` class use `var(--font-mono)` (JetBrains Mono)
- Edge case: `--yes-bg` and `--no-bg` are rgba values, not hex — verify they render correctly in CSS
- Integration: existing Tailwind classes that reference `bg-background`, `text-foreground`, `border-border` still resolve (Tailwind theme inline block updated)

**Verification:**
- `body` background is `#0a0a0b` (pure black, not `#121212`)
- Page title is "Clipmarket — Predict TikTok's Next Hit"
- Numeric values in trade panel render in JetBrains Mono

---

- [ ] **Unit 2: ClipmarketLogo Component**

**Goal:** Create a reusable `ClipmarketLogo` component matching the design's conic-gradient square mark + wordmark.

**Requirements:** R4

**Dependencies:** Unit 1 (tokens must be in place)

**Files:**
- Create: `src/components/ClipmarketLogo.tsx`

**Approach:**
- Props: `size?: number` (default 16, controls wordmark font-size; mark scales at 1.5×), `mark?: boolean` (default true — show/hide the icon square)
- Mark: square div with `conic-gradient(from 220deg, var(--yes), var(--no), var(--yes))`, inner div with bg-bg-0, centered "C" in monospace bold
- Wordmark: "clipmarket" in `var(--font-sans)`, weight 600, `letter-spacing: -0.02em`, color `var(--ink-0)`

**Patterns to follow:**
- Existing `SidebarClient` logo placeholder (text "Virality") — replace with this component

**Test scenarios:**
- Test expectation: none — pure presentational component with no behavior

**Verification:**
- Logo renders correctly at size=16 (sidebar) and size=13 (mobile top bar)
- Mark shows conic gradient border with dark inner square

---

- [ ] **Unit 3: Navigation Redesign (Sidebar + Bottom Nav + AppShell TopBar)**

**Goal:** Update sidebar with ClipmarketLogo, new active-state styling, and Markets sub-menu. Update bottom nav active state. Add desktop top bar. Wire top bar into AppShell.

**Requirements:** R4, R5, R6

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `src/components/SidebarClient.tsx`
- Modify: `src/components/BottomNavClient.tsx`
- Create: `src/components/DesktopTopBar.tsx`
- Modify: `src/components/AppShell.tsx`

**Approach:**
- `SidebarClient`: Replace `<Link>` logo text with `<ClipmarketLogo />`. Update active nav item: `background: var(--bg-2)`, icon color `var(--yes-ink)`, dot indicator `var(--yes-ink)`. Add Markets sub-section (static links for Trending, Ending Soon, New, Resolved — href placeholders, non-functional in this pass). User balance section uses `var(--font-mono)` for coin count. Sidebar width stays 224px (`w-56`).
- `BottomNavClient`: Active item color → `var(--yes-ink)`. Remove `text-accent` class references.
- `DesktopTopBar`: New `"use client"` component. Accepts `title: string`, `subtitle?: string`, `rightSlot?: React.ReactNode`. Renders: left side = title + subtitle separated by `·`; right side = rightSlot (search button placeholder + LIVE dot + "LIVE" mono label). Height 52px, `border-bottom: 1px solid var(--line)`.
- `AppShell`: Add the `DesktopTopBar` above `<main>` in the desktop layout. For the initial pass, title can be derived from `usePathname` mapping, or kept as a static "Discover" default. The market detail page provides its own breadcrumb inline (not via AppShell TopBar).

**Patterns to follow:**
- `src/components/SidebarClient.tsx` — existing structure, extend in place
- `src/components/BottomNavClient.tsx` — existing structure

**Test scenarios:**
- Happy path: sidebar active item (Discover, when on `/`) shows cyan dot indicator and lighter background
- Happy path: desktop top bar renders above main content area on `md+` screens, hidden on mobile
- Edge case: Markets sub-menu links are static (non-functional) and do not affect active state logic
- Integration: `BottomNavClient` active state on `/leaderboard` uses cyan, not `text-accent`

**Verification:**
- Desktop shows 52px top bar with "Discover" title and LIVE indicator
- Mobile shows no top bar (it lives inside individual page layouts)
- Sidebar width unchanged, no layout shift

---

- [ ] **Unit 4: State Badge Redesign**

**Goal:** Replace the inline `PROJECTION_BADGE` map in `FeedCard.tsx` with a shared `StateBadge` component using Clipmarket color tokens; update `MarketHUD.tsx` usage.

**Requirements:** R7

**Dependencies:** Unit 1

**Files:**
- Create: `src/components/StateBadge.tsx`
- Modify: `src/components/FeedCard.tsx`
- Modify: `src/components/MarketHUD.tsx`

**Approach:**
- `StateBadge` props: `label: ProjectionLabel`. Renders a pill badge with:
  - `ON_TRACK`: `--ok` (green) bg/border/text; includes `.live-dot` pulsing dot
  - `AT_RISK`: `--no-ink` (orange) bg/border/text
  - `BREAKING_OUT`: `--yes-ink` (cyan) bg/border/text
- Text: `ON TRACK`, `AT RISK`, `BREAKING OUT` (all-caps, 10px, 0.1em tracking)
- Import type `ProjectionLabel` from `@/db/schema`
- `FeedCard.tsx`: remove `PROJECTION_BADGE` map; use `<StateBadge label={projectionLabel} />` when `projectionLabel` is set
- `MarketHUD.tsx`: locate existing projection label rendering; replace with `<StateBadge />`

**Patterns to follow:**
- `src/components/MarketStatusBadge.tsx` — pill badge pattern (stays separate; handles lifecycle states)
- `src/components/FeedCard.tsx:PROJECTION_BADGE` — exact code to replace

**Test scenarios:**
- Happy path: `ON_TRACK` → green badge with pulsing dot
- Happy path: `AT_RISK` → orange badge
- Happy path: `BREAKING_OUT` → cyan badge
- Edge case: `null` projectionLabel → renders nothing (guard in FeedCard already exists)

**Verification:**
- FeedCard shows colored badge matching design for each projection state
- No TypeScript errors from ProjectionLabel type narrowing

---

- [ ] **Unit 5: Trade Ticket Redesign**

**Goal:** Redesign `TradePanel.tsx` visual layout: YES/NO as tall price-tile buttons, % chip row replacing the slider, payout breakdown summary card. Keep all existing LMSR math and server action wiring intact.

**Requirements:** R9

**Dependencies:** Unit 1

**Files:**
- Modify: `src/components/TradePanel.tsx`
- Modify: `src/components/BetSheet.tsx` (mobile trade sheet uses TradePanel; verify no layout conflicts)

**Approach:**
- YES/NO selector: Two buttons in a 1fr/1fr grid, each 56px tall. Left button: label "YES" (10px, tracking, `--yes-ink`), price below as `{Math.round(prices[0] * 100)}¢` (18px mono bold). Right button: same for NO with `--no-ink`. Selected state: colored background (`--yes-bg` / `--no-bg`) + colored border (`--yes-border` / `--no-border`). Unselected: `--bg-2` bg, `--line` border.
- Amount input: Replace `CoinSlider` with a direct `<input type="number">` inside a row with coin icon (16px SVG). Below input: a 5-chip row for 10% / 25% / 50% / 75% / 100% of balance. Each chip: `height: 22px`, `font-mono`, `font-size: 10px`, `bg-bg-2`, `border-line`.
- Payout breakdown: A `--bg-2` card below the chips showing 3 rows:
  1. "Payout if YES/NO wins" → computed payout (colored, bold)
  2. "Profit" → payout - amount
  3. "Price impact" → `+{priceImpact.toFixed(2)}%` (muted)
- Submit button: Full-width 44px, `bg-yes` / `bg-no`, dark text, font-weight 600
- Preserve all existing state (`outcome`, `amount`, `isPending`, `staleConfirm`, error flash) — only the JSX layout changes

**Patterns to follow:**
- `src/components/TradePanel.tsx` — existing LMSR math (`payoutYes`, `payoutNo`, `priceImpact`) feeds the new summary card unchanged
- `src/components/CoinSlider.tsx` — may be removed if unused after this change (defer decision to implementation)

**Test scenarios:**
- Happy path: clicking YES tile → tile highlighted cyan, "Buy YES · N coins" submit button appears
- Happy path: clicking 25% chip with balance 611 → amount sets to 152 (Math.floor(611 * 0.25))
- Happy path: payout summary shows correct coins based on current LMSR math
- Edge case: balance = 0 → all % chips set amount to 0; submit button stays enabled but server rejects
- Error path: balance fetch fails → fallback 500 used; no visual breakage
- Integration: trade success triggers `onTradeSuccess` callback, sheet closes, balance SWR revalidates

**Verification:**
- Both YES and NO tile buttons show current price in cents
- Payout breakdown updates in real-time as amount changes
- Existing double-submit prevention (`isChecking`) still works

---

- [ ] **Unit 6: View Trajectory Chart Redesign**

**Goal:** Redesign `VideoStatsChart.tsx` to be static-range (full 24h visible without scroll), show milestone as a horizontal goal line, and support hover crosshair with tooltip.

**Requirements:** R8

**Dependencies:** Unit 1

**Files:**
- Modify: `src/components/VideoStatsChart.tsx`

**Approach:**
- Keep `lightweight-charts` library (already installed)
- Chart config changes:
  - `timeScale.fixedLeftEdge: true`, `timeScale.fixedRightEdge: true` — no scrolling
  - `timeScale.from`/`to` set to `[market creation time, resolvesAt]` so the entire 24h window is visible; the goal is always at the right edge
  - Area series fill: gradient from `var(--yes)` (top) to transparent (bottom); line color `var(--yes)`
  - Milestone horizontal line: add a `LineSeries` at constant Y = `milestoneThreshold`; `color: var(--no-ink)`, `lineStyle: LineStyle.Dashed`; no interaction
  - Crosshair: `mode: CrosshairMode.Magnet`, show tooltip on hover (subscribe to `chart.subscribeCrosshairMove`) displaying time + view count formatted with `formatCount`
  - Grid lines: match `var(--line)` token (rgba(255,255,255,0.06))
  - Text color: `var(--ink-3)` (#71717a)
- Props: add optional `from?: number` and `to?: number` (Unix timestamps for window bounds); `MarketHUD` or the market detail page passes `market.createdAt` and `market.resolvesAt`

**Patterns to follow:**
- `src/components/VideoStatsChart.tsx` — existing chart init pattern (`useEffect` + `createChart`)
- `src/components/PriceChart.tsx` — may also need the same grid/color token update (update in parallel but don't change its data model)

**Test scenarios:**
- Happy path: chart renders with milestone dashed line visible within the canvas (not off-screen)
- Happy path: hovering over a data point shows tooltip with formatted view count and time
- Edge case: `data` array has only 1 point (new market, minimal poll history) → renders single dot, no crash
- Edge case: `from` and `to` are identical (e.g. resolvesAt already passed) → chart still renders without error

**Verification:**
- Milestone line is visible in the chart without any scrolling or zoom action
- Chart colors match new design tokens (no hardcoded `#2a2a3a` or `#4169e1`)

---

- [ ] **Unit 7: Market Detail Page — Desktop 3-Column Layout**

**Goal:** Restructure `markets/[id]/page.tsx` to a 3-column desktop layout with collapsible right metrics rail and dense stat strip.

**Requirements:** R10

**Dependencies:** Units 1, 4, 5, 6

**Files:**
- Modify: `src/app/markets/[id]/page.tsx`
- Create: `src/components/LiveMetricsRail.tsx`
- Create: `src/components/DenseStatStrip.tsx`

**Approach:**
- `DenseStatStrip`: A `"use client"` component. Props: `market: MarketData`. Renders a 6-column CSS grid of metric cells. Each cell: label (`.label-sm`) + value (`.mono .num`). Metrics: Current Views, Target, Progress %, Views/Hr (latest velocity from `pollHistory`), Required/Hr (computed from threshold - current) / remaining hours), Velocity ratio, YES price (¢), NO price (¢), Volume (total from trades), Likes, Comments, Shares. Velocity ratio tone: `--pos` if ≥ 1.0, `--neg` if < 1.0.
- `LiveMetricsRail`: `"use client"` wrapper for the collapsible right rail. State: `open: boolean` (default `false`, persisted to `localStorage` with key `cm_rail`). Collapsed: 38px vertical strip with rotated "Live Metrics" label + toggle arrow. Expanded: 320px panel with `<DenseStatStrip>` plus real-time poll data.
- Page layout: On `lg+` screens, use a 3-section structure: `flex` row with (1) 340px left column (video, creator, description), (2) flex-1 center column (YES/NO bar, `<TradePanel>`, `<VideoStatsChart>`, resolution rules), (3) `<LiveMetricsRail>` on the right. `<MarketLiveData>` moves to below the flex row (full width). Mobile layout stays `flex-col` (unchanged).
- The breadcrumb (`← Discover / Market / M1`) is implemented inline in the page, not via AppShell TopBar (since this page has unique breadcrumb data).

**Patterns to follow:**
- `src/app/markets/[id]/page.tsx` — existing data fetching stays unchanged; only JSX layout changes
- `src/components/MarketLiveData.tsx` — remains below the main layout row

**Test scenarios:**
- Happy path: on desktop (`lg+`), layout shows 3 columns with right rail collapsed by default
- Happy path: clicking rail toggle expands to 320px with DenseStatStrip metrics
- Happy path: `localStorage` persists rail open/closed state across page navigations
- Edge case: market has no pollHistory → DenseStatStrip shows `—` for velocity and progress metrics
- Edge case: market is resolved → DenseStatStrip still renders; no crash on computed velocity
- Integration: `TradePanel` in center column calls `onTradeSuccess` correctly; `LiveMetricsRail` re-renders via SWR after trade

**Verification:**
- Desktop shows 3 columns; video is ~340px wide at 9:16 aspect ratio
- Rail toggles cleanly without layout shift on the center column
- Mobile layout unchanged (single column, existing behavior)

---

- [ ] **Unit 8: Mobile Discover — View Toggle + Doomscroll HUD**

**Goal:** Add a doomscroll ↔ grid view toggle to mobile Discover; update doomscroll FeedCard HUD to show YES/NO split bar and sparkline inline.

**Requirements:** R11

**Dependencies:** Units 1, 4

**Files:**
- Modify: `src/components/DiscoverFeed.tsx`
- Modify: `src/components/FeedCard.tsx`

**Approach:**
- `DiscoverFeed.tsx`: Add `viewMode: 'scroll' | 'grid'` state, initialized from `localStorage.getItem('cm_view_mode') || 'scroll'`. In `'scroll'` mode: render the existing doomscroll `<div ref={feedColumnRef}>` with FeedCards. In `'grid'` mode: render `<FeedEndGrid>` directly (the existing grid component that previously appended at scroll end). Remove the `<FeedEndGrid>` from the scroll sentinel section when in scroll mode (it's now the exclusive grid view). The view toggle button renders at the top of the mobile layout: icon-only, 36×36px, glass background. `localStorage.setItem('cm_view_mode', viewMode)` on every change.
- `FeedCard.tsx`: In the doomscroll HUD area (above the YES/NO price buttons), add a 4px YES/NO split progress bar (inline flex, `--yes` fills YES%, `--no` fills NO%). Add current view count / milestone count as a micro-line below ("438K / 650K views"). The sparkline (view trajectory mini-chart) is deferred — implement only if straightforward within this unit's scope; otherwise omit and note as future task. Projection badge (`<StateBadge>`) is shown in the top-left overlay area.

**Patterns to follow:**
- `src/components/DiscoverFeed.tsx` — existing `sheet` state and `feedColumnRef` — don't disturb scroll/IntersectionObserver logic
- `src/components/FeedCard.tsx` — existing density system and HUD layout

**Test scenarios:**
- Happy path: Discover page defaults to doomscroll mode; toggle switches to grid and back
- Happy path: `localStorage` preserves view mode across soft navigations
- Happy path: FeedCard doomscroll HUD shows cyan/orange split bar with correct proportions
- Edge case: `priceYes = 0` → split bar shows 0% YES, 100% NO without crash
- Edge case: `currentCount = null` → view count line shows "— / Xk views"
- Integration: switching from scroll to grid mode does not leave any FeedCard `activate()` invocations dangling (cards deactivate correctly on unmount via existing cleanup)

**Verification:**
- Grid/doomscroll toggle is visible and functional on mobile viewport
- YES/NO split bar appears in doomscroll HUD above the price buttons
- Grid mode shows the existing `FeedEndGrid` layout without regression

---

- [ ] **Unit 9: Desktop Discover — Live Markets Collapsible Rail**

**Goal:** Add a collapsible Live Markets right rail to the desktop discover feed.

**Requirements:** R12

**Dependencies:** Units 1, 3

**Files:**
- Modify: `src/app/page.tsx` (home page that renders DiscoverFeed)
- Create: `src/components/LiveMarketsRail.tsx`

**Approach:**
- `LiveMarketsRail`: `"use client"` component. Props: `markets: FeedMarket[]`. State: `open: boolean` (default `false`, `localStorage` key `cm_discover_rail`). Collapsed: 38px vertical strip; "LIVE MARKETS" vertical label (`.label-sm`) + count badge + `›` expand arrow. Expanded: 280px panel showing a scrollable list of market cards — each card shows: video gradient thumbnail (40×56px), question truncated to 2 lines, YES/NO price badges, time remaining. On click, navigates to `/markets/[id]`.
- `page.tsx`: The home page receives market data server-side. Wrap the discover area in a `flex` row: `<DiscoverFeed>` (flex-1) + `<LiveMarketsRail>` (hidden on mobile via `hidden md:flex`). Pass `gridMarkets` (currently passed to DiscoverFeed) to LiveMarketsRail as its market list.

**Patterns to follow:**
- `src/app/page.tsx` — existing server-side data fetch pattern; LiveMarketsRail gets the same market data already fetched
- `LiveMetricsRail` (Unit 7) — same collapse/expand pattern

**Test scenarios:**
- Happy path: desktop shows collapsed Live Markets strip (38px) by default
- Happy path: expanding shows list of markets with YES/NO prices and countdown
- Happy path: rail state persists in localStorage across page reloads
- Edge case: 0 active markets → expanded state shows empty state ("No active markets")
- Edge case: mobile viewport → rail is hidden (`hidden md:flex`); layout unaffected

**Verification:**
- Desktop discover shows collapsible rail without affecting the DiscoverFeed layout
- Rail does not trigger additional API calls (reuses data already fetched by server component)

---

## System-Wide Impact

- **Interaction graph**: `AppShell` wraps all pages — the sidebar and bottom nav token changes affect every page simultaneously. `DiscoverFeed` renders `FeedCard` × N — any change to `FeedCard` affects all N cards in the scroll feed.
- **Error propagation**: All token changes are CSS-only; no JS error surface. `TradePanel` changes are view-layer only; the server action `buyShares` path is untouched.
- **State lifecycle risks**: `localStorage` keys introduced: `cm_view_mode` (mobile view toggle), `cm_rail` (market detail right rail), `cm_discover_rail` (discover live markets rail). These are all ephemeral UI state — no data integrity risk.
- **API surface parity**: No new API routes or mutations. All data contracts unchanged.
- **Integration coverage**: The most complex cross-layer integration is Unit 7's market detail 3-column layout — it restructures how `MarketHUD`, `TradePanel`, `VideoStatsChart`, and `MarketLiveData` are composed without changing any of their internal logic. Verify no prop is dropped during the restructure.
- **Unchanged invariants**: All server actions (`buyShares`, `sellShares`, `previewTrade`), API routes (`/api/markets`, `/api/balance`, `/api/feed/polls`), DB schema, and auth middleware are unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Tailwind utility classes referencing `text-accent`, `bg-accent` scattered across many components | Grep pass in Unit 1; compile-time TypeScript won't catch these; run the dev server and visually audit |
| `CoinSlider` component may be left unused after Unit 5 | Check `CoinSlider` imports after Unit 5; remove if unreferenced |
| Desktop 3-column layout may cause overflow on 1280px screens (sidebar 224px + 340px video + 320px rail = 884px + trade panel) | On 1280px: rail starts collapsed; only video + trade panel need to fit in ~816px. Verify at 1280px before calling complete |
| `lightweight-charts` chart range-locking behavior may behave unexpectedly when `from === to` | Add guard: if `from >= to`, don't set range; render default auto-range |
| Mobile view toggle may conflict with existing scroll/IntersectionObserver setup in DiscoverFeed | Test unmount/remount of scroll feed when toggling; existing `deactivate()` calls must fire on all active cards before switching to grid |

## Documentation / Operational Notes

- The `package.json` `"name": "virality"` field is internal only — no user-visible impact. Leave unchanged.
- The `vercel.json` cron configuration is unchanged.
- No environment variables change.

## Sources & References

- **Origin document:** Design bundle at `/tmp/clipmarket-design/clipmarket/project/Clipmarket.html` (design source)
- Design tokens: `/tmp/clipmarket-design/clipmarket/project/styles/tokens.css`
- Component primitives: `/tmp/clipmarket-design/clipmarket/project/components/primitives.jsx`
- Desktop shell: `/tmp/clipmarket-design/clipmarket/project/components/desktop-shell.jsx`
- Mobile components: `/tmp/clipmarket-design/clipmarket/project/components/mobile.jsx`
- Chat transcript intent: `/tmp/clipmarket-design/clipmarket/chats/chat1.md`
- Related code: `src/app/globals.css`, `src/app/layout.tsx`, `src/components/AppShell.tsx`, `src/components/TradePanel.tsx`, `src/components/VideoStatsChart.tsx`, `src/components/DiscoverFeed.tsx`, `src/components/FeedCard.tsx`, `src/app/markets/[id]/page.tsx`
