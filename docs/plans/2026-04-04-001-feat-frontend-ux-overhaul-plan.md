---
title: "feat: Virality Frontend UI/UX Overhaul — Trading Platform Aesthetic"
type: feat
status: active
date: 2026-04-04
---

# feat: Virality Frontend UI/UX Overhaul — Trading Platform Aesthetic

## Overview

Full frontend redesign of the Virality prediction market app, replacing the current basic AI-generated UI with a polished, professional trading platform aesthetic. Backend logic is unchanged — only the presentation layer is replaced.

Target feel: **Phantom Wallet × Polymarket × Robinhood Web** — dark glassmorphic cards, teal-to-purple gradient accents, desktop-first sidebar layout, live ticking data.

Target audience: Gen Z / early-20s users who expect a professional crypto/trading experience. Professional and trustworthy, never childish.

---

## Problem Statement

The current UI was AI-scaffolded quickly and lacks visual credibility. A prediction market for viral videos needs to look like a real trading platform to drive trust and engagement — not a generic Next.js starter. Specific gaps:

- Horizontal top navbar wastes vertical space; modern trading apps use fixed sidebars
- MarketCards show static thumbnails with minimal visual hierarchy
- TradePanel is functional but plain — no animated price feedback, no probability gauge
- Portfolio page is a basic table — no hero balance, no P&L chart
- Color system uses indigo `#6366f1`; needs to become teal-to-purple gradient
- No glassmorphic card depth, no micro-animations, no live-data visual polish

---

## Proposed Solution

Three-phase implementation:

1. **Foundation** — New design tokens, font, and app shell (sidebar layout)
2. **Core screens** — Discover feed, Market Detail, Portfolio Dashboard (all 3 pages rebuilt)
3. **Polish pass** — Animations, hover states, live data pulse, accessibility audit

All existing API routes, Server Actions, SWR hooks, data types, and backend logic remain untouched. Only components, pages, and globals.css change.

---

## Technical Approach

### Architecture

**Layout restructure** is the most impactful change. Currently:

```
RootLayout
  └─ <Navbar>       ← horizontal, h-14
  └─ <main>         ← flex-1
```

New structure:

```
RootLayout (no Navbar)
  └─ <AppShell>        ← client component, "use client"
       ├─ <Sidebar>    ← fixed left, w-60, full-height
       └─ <div>        ← ml-60, flex flex-col
            ├─ <TopBar>
            └─ <main>  ← flex-1, overflow-y-auto
```

`AppShell` is a client component to handle sidebar collapse state. Pages remain server components and are unaffected.

**Tailwind v4 CSS variables** (globals.css `@theme inline`) are the only theming mechanism — update them in one place, entire app re-themes. No component library will be added; all components remain custom Tailwind.

**lightweight-charts** is already present — will be used for the 6h YES-price chart and P&L sparklines. Chart colors will be updated to the new accent palette.

**SWR polling** (already in `MarketLiveData`, `LiveEngagementStats`, `BalanceChip`) powers all live data — no changes needed to data layer.

### Design Tokens (globals.css changes)

```css
/* src/app/globals.css — updated variables */
:root {
  --background: #0A0A0A;
  --foreground: #F0F0F5;
  --card: #111111;
  --card-hover: #181818;
  --border: #1E1E2E;
  --border-hover: #2A2A3A;

  /* Gradient endpoints — use as individual accents or combine */
  --accent: #00E5C0;          /* teal — YES, primary CTA */
  --accent-2: #8B5CF6;        /* purple — secondary, gradient end */
  --accent-hover: #00CCB0;

  /* Semantic colors */
  --yes: #00E5C0;             /* teal for YES */
  --no: #EF4444;              /* red for NO (keep) */
  --green: #22C55E;           /* P&L positive */
  --red: #EF4444;             /* P&L negative */
  --muted: #52525B;
  --muted-2: #71717A;

  /* Glass effect */
  --glass-bg: rgba(17, 17, 17, 0.8);
  --glass-border: rgba(255, 255, 255, 0.06);
}
```

The gradient `linear-gradient(135deg, #00E5C0, #8B5CF6)` will be used as:
- Logo text gradient
- CTA button backgrounds
- Active sidebar nav indicator
- Gauge fill arcs

### Font

Replace Geist with **Inter** (Google Fonts). Update `src/app/layout.tsx`:

```tsx
import { Inter } from "next/font/google";
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
```

Inter is visually very close to Satoshi — clean, geometric, professional.

---

## Component Breakdown

### New / Replaced Global Components

#### `src/components/layout/AppShell.tsx`
```
Props: { children: ReactNode }
State: sidebarCollapsed (useState, default false on desktop)
Renders: Sidebar + TopBar + main content
Notes: "use client". Wraps layout.tsx children.
```

#### `src/components/layout/Sidebar.tsx`
```
Props: { collapsed?: boolean, onToggle: () => void }
Nav items: Discover (/), Markets (/), Portfolio (/portfolio),
           Leaderboard (/leaderboard), Activity (/history)
Each item: icon (inline SVG) + label, active state via usePathname()
Bottom: user avatar + settings link
Design: w-60 fixed left, bg-card, border-r border-glass-border
Active indicator: left border 2px gradient teal→purple + text-accent
```

#### `src/components/layout/TopBar.tsx`
```
Props: { session: Session | null, initialBalance: number | null }
Contents: logo (hidden on desktop since sidebar has it),
          SearchInput, BalanceChip (existing), NotificationBell, UserMenu (existing)
Design: h-14, border-b border-glass-border, sticky top-0, bg-glass-bg backdrop-blur
Notes: Server component — fetches nothing new, passes props down
```

#### `src/components/ui/GlassCard.tsx`
```
Props: { children, className?, hover?: boolean, padding?: "sm"|"md"|"lg" }
Design: bg-card border border-glass-border rounded-2xl backdrop-blur-sm
        hover:translate-y-[-4px] hover:border-border-hover transition-all duration-200
Notes: The base card for all cards in the redesign. Replaces inline bg-card classes.
```

#### `src/components/ui/GradientBadge.tsx`
```
Props: { children, variant: "yes"|"no"|"gradient" }
Design: pill with teal bg (YES), red bg (NO), or gradient bg
Used in: VideoCard, MarketDetail header
```

---

### Discover / Home Feed Components

#### `src/components/discover/VideoCard.tsx` ← replaces `MarketCard.tsx`
```
Props: {
  id: string
  title: string
  status: MarketStatus
  priceYes: number
  priceNo: number
  resolvesAt: Date | null
  outcome: number | null
  milestoneThreshold: bigint
  questionType: QuestionType
  currentViews?: number | null
  videoMetadata: { title, thumbnail, channelTitle, playUrl?, creatorId? } | null
}
Features:
  - Hover-to-play: onMouseEnter → <video autoPlay muted loop> the playUrl
    onMouseLeave → pause and reset to thumbnail. Use useRef + state.
  - Progress bar: "847 / 2,000 views • 18h left" — computed from currentViews + milestoneThreshold + resolvesAt
  - YES/NO price pills: teal / red with percentage
  - Volume text (tiny, muted)
  - Card lift 4px on hover via GlassCard hover prop
Design: aspect-[9/16] for portrait TikTok feel, or aspect-video for landscape
Note: Replaces the static Image + border-accent hover in the current MarketCard.
```

#### `src/components/discover/HeroCard.tsx`
```
Props: same as VideoCard but full-width, larger
Design: full-bleed video bg, gradient overlay, title + price pills overlaid
Used: first card in the feed as hero feature
```

#### `src/components/discover/FilterChips.tsx`
```
Props: { active: string, onChange: (cat: string) => void, categories: string[] }
Design: horizontal scroll chips, active = gradient bg, inactive = glass border
"Hot" indicator: amber dot pulse on categories with high volume
Notes: Client component. Categories: All, Music, Comedy, Challenges (derived from videoMetadata tags or hardcoded)
```

#### `src/components/discover/MarketGrid.tsx` ← replaces inline `MarketGrid` in page.tsx
```
Props: { markets: MarketCardProps[], featured?: MarketCardProps }
Design: CSS grid, repeat(auto-fill, minmax(280px, 1fr)), gap-4
        First item rendered as HeroCard spanning full width (col-span-full)
Notes: Server component.
```

---

### Market Detail Components

#### `src/components/market/MarketDetailLayout.tsx`
```
Props: { initialData: MarketData, session: Session | null }
Design: flex flex-row h-full
  Left (60%): VideoPane
  Right (40%): TradingPanel
Notes: Replaces MarketLiveData as the top-level client shell for the detail page.
       Keeps SWR polling logic from MarketLiveData unchanged internally.
```

#### `src/components/market/VideoPane.tsx`
```
Props: { videoId, playUrl, thumbnail, title, creatorId, pollHistory, marketId }
Contents:
  - TikTokEmbed (existing, unchanged) — full bleed in left pane
  - LiveViewCounter: large animated number showing latest view count
  - ViewVelocitySparkline: small 6h area chart of view velocity (views/hour)
Design: sticky top, rounded-2xl overflow-hidden
```

#### `src/components/market/LiveViewCounter.tsx`
```
Props: { value: number | null, target: bigint, label: string }
Design: large bold number (tabular-nums), subtle pulse animation on update
        Progress bar below: currentViews / milestoneThreshold
Notes: "use client". Animates via CSS transition on value change.
```

#### `src/components/market/ViewVelocitySparkline.tsx`
```
Props: { pollHistory: { time: string, viewCount: number | null }[] }
Computes: delta views per poll interval → velocity array
Renders: lightweight-charts AreaSeries, height 80px, no axes, just the shape
Design: accent color (#00E5C0), minimal grid
```

#### `src/components/market/TradingPanel.tsx` ← replaces `TradePanel.tsx`
```
Props: { marketId, prices: number[], onTradeSuccess?: (result) => void }
Sections:
  1. PriceTickerDisplay — large YES price + delta indicator (green/red)
  2. ProbabilityGauge — circular SVG arc gauge (0–100%), filled teal→purple gradient
  3. VolumeDisplay — total volume traded
  4. PriceLineChart — 6h YES-price (lightweight-charts, reuses PriceChart logic)
  5. OrderForm — YES/NO toggle tabs, amount slider + presets [10, 25, 50, 100],
                 live preview payout, "Place Bet" CTA button
Design: bg-card border glass rounded-2xl p-5, sticky top-4
Notes: "use client". Keep all buyShares / previewTrade logic from TradePanel unchanged.
       This is a visual replacement, not a logic replacement.
```

#### `src/components/market/PriceTickerDisplay.tsx`
```
Props: { price: number, prevPrice?: number }
Design: 
  - Large price "67%" in bold
  - Delta badge "+2.3%" green or "-1.1%" red with arrow icon
  - Subtle ease-in transition on price change (CSS transition)
Notes: "use client". Tracks prevPrice to compute delta direction.
```

#### `src/components/market/ProbabilityGauge.tsx`
```
Props: { probability: number, size?: number }
Design: SVG circle. Two arcs — background gray, filled teal→purple gradient.
        Center text: "67%" bold
        Computed: strokeDasharray from probability
Notes: Pure SVG, no external chart lib needed.
```

#### `src/components/market/OrderForm.tsx`
```
Props: { marketId, outcome, setOutcome, amount, setAmount, preview, onBuy, isPending, error }
Design: 
  - YES/NO toggle: two large pills (teal tinted / red tinted), active = solid gradient
  - Amount slider: range input styled with accent track fill + preset buttons
  - Payout preview: "If YES resolves → +X coins" in subtle bg-background rounded card
  - "Place Bet" button: full-width, gradient bg, uppercase, disabled state
Notes: Pure presentational — state managed by TradingPanel parent.
```

---

### Portfolio Dashboard Components

#### `src/app/portfolio/page.tsx` ← full rewrite (server component)
New layout: two-column on desktop
```
Left (60%):
  - PortfolioHeroCard (balance + total value + P&L)
  - ActiveContractsGrid (card grid of open positions)
Right (40%):
  - PnLChart (lightweight-charts line chart)  
  - ActivityFeed (recent trades)
  - LeaderboardPreview (top 5 rows, link to full leaderboard)
```

#### `src/components/portfolio/PortfolioHeroCard.tsx`
```
Props: { balance: number, openValue: number, totalValue: number }
Design: GlassCard, gradient border, large numbers with tabular-nums
        "Total Value" in gradient text, balance + open value sub-stats
```

#### `src/components/portfolio/ContractCard.tsx`
```
Props: { position, market, currentPrice, markToMarket, pnl, costBasis }
Design: GlassCard row — mini thumbnail (40px) + market title + YES/NO badge
        + current price + mark-to-market + P&L (colored) + SellButton
Notes: Replaces the table rows in the current portfolio. Mobile-friendly card format.
```

#### `src/components/portfolio/PnLChart.tsx`
```
Props: { trades: RecentTrade[] }
Computes: cumulative P&L over time from trade history
Renders: lightweight-charts AreaSeries, green fill if positive, red if negative
Design: height 200px, transparent bg, accent grid
```

#### `src/components/portfolio/ActivityFeed.tsx`
```
Props: { trades: { trade, market }[] }
Design: scrollable list, each item: BUY/SELL badge + YES/NO + market title + coins
        Timestamps relative ("2h ago")
Notes: Extract from current portfolio page inline JSX.
```

#### `src/components/portfolio/LeaderboardPreview.tsx`
```
Props: { entries: { rank, name, totalValue }[] }
Design: simple ranked list (rank number + avatar initial + name + value)
        "View Full Leaderboard" link at bottom
Notes: No gamification — clean numbers only.
```

---

### Updated Existing Components

| Component | Change |
|---|---|
| `src/app/layout.tsx` | Remove Navbar import, wrap children in AppShell, switch to Inter font |
| `src/components/Navbar.tsx` | **Delete** — replaced by Sidebar + TopBar |
| `src/components/BalanceChip.tsx` | Keep logic, update styling to pill with gradient border |
| `src/components/UserMenu.tsx` | Keep logic, update styling |
| `src/components/PriceChart.tsx` | Update colors to new accent `#00E5C0`, keep API identical |
| `src/components/MarketStatusBadge.tsx` | Update color tokens |
| `src/components/CountdownTimer.tsx` | Keep, update text colors |
| `src/components/SellButton.tsx` | Keep logic, update styling to GlassCard button |

---

## File Structure

```
src/
  app/
    globals.css                   ← update CSS variables + Inter font
    layout.tsx                    ← replace Navbar with AppShell
    page.tsx                      ← rewrite for new discover layout
    markets/[id]/page.tsx         ← replace layout div with MarketDetailLayout
    portfolio/page.tsx            ← full rewrite to two-column layout
  components/
    layout/
      AppShell.tsx                ← NEW
      Sidebar.tsx                 ← NEW
      TopBar.tsx                  ← NEW
    ui/
      GlassCard.tsx               ← NEW
      GradientBadge.tsx           ← NEW
    discover/
      VideoCard.tsx               ← NEW (replaces MarketCard.tsx)
      HeroCard.tsx                ← NEW
      FilterChips.tsx             ← NEW
      MarketGrid.tsx              ← NEW
    market/
      MarketDetailLayout.tsx      ← NEW (replaces MarketLiveData as outer shell)
      VideoPane.tsx               ← NEW
      LiveViewCounter.tsx         ← NEW
      ViewVelocitySparkline.tsx   ← NEW
      TradingPanel.tsx            ← NEW (replaces TradePanel.tsx)
      PriceTickerDisplay.tsx      ← NEW
      ProbabilityGauge.tsx        ← NEW
      OrderForm.tsx               ← NEW
    portfolio/
      PortfolioHeroCard.tsx       ← NEW
      ContractCard.tsx            ← NEW
      PnLChart.tsx                ← NEW
      ActivityFeed.tsx            ← NEW
      LeaderboardPreview.tsx      ← NEW
    [existing components]         ← update styling, keep logic
```

---

## Implementation Phases

### Phase 0 — Design Foundation (no UI changes yet)

1. Update `src/app/globals.css`: replace all CSS variables with new palette (see Design Tokens above)
2. Update `src/app/layout.tsx`: switch `Geist` → `Inter` from `next/font/google`
3. Update `src/components/PriceChart.tsx`: change `lineColor` from `#6366f1` → `#00E5C0`
4. Verify app still renders (styling changes only, no layout changes yet)

**Success criteria:** App loads, color shift visible, no regressions.

---

### Phase 1 — App Shell (Sidebar Layout)

**Dependencies:** Phase 0 complete.

1. Create `src/components/layout/AppShell.tsx` — accepts `children`, renders sidebar + topbar wrapper
2. Create `src/components/layout/Sidebar.tsx` — nav items with `usePathname()` for active state
3. Create `src/components/layout/TopBar.tsx` — search input + BalanceChip + UserMenu slots
4. Update `src/app/layout.tsx`:
   - Remove `<Navbar />` import
   - Wrap `<main>` with `<AppShell session={session}>`
   - Move balance fetch from Navbar to TopBar (or keep in AppShell)
5. Delete `src/components/Navbar.tsx` ← after verifying TopBar covers all nav items
6. Create `src/components/ui/GlassCard.tsx`
7. Create `src/components/ui/GradientBadge.tsx`

**Success criteria:** Fixed sidebar visible on all pages, top bar replaces horizontal nav, all nav links functional, BalanceChip in top bar, responsive (sidebar collapses to icon-only or slides off on mobile).

---

### Phase 2 — Discover / Home Feed

**Dependencies:** Phase 1 complete.

1. Create `src/components/discover/VideoCard.tsx` — with hover-to-play logic
2. Create `src/components/discover/HeroCard.tsx`
3. Create `src/components/discover/FilterChips.tsx`
4. Create `src/components/discover/MarketGrid.tsx`
5. Rewrite `src/app/page.tsx` to use new components:
   - Hero: first active market as HeroCard
   - FilterChips (client island — use `"use client"` wrapper)
   - MarketGrid with VideoCards

**Success criteria:** Home feed shows hero card + grid with hover-to-play video previews, YES/NO price pills, progress bar showing view progress toward threshold, category filter chips visible.

---

### Phase 3 — Market Detail Page

**Dependencies:** Phase 1 complete, Phase 0 colors applied to PriceChart.

1. Create `src/components/market/ProbabilityGauge.tsx` (pure SVG, no deps)
2. Create `src/components/market/PriceTickerDisplay.tsx`
3. Create `src/components/market/LiveViewCounter.tsx`
4. Create `src/components/market/ViewVelocitySparkline.tsx`
5. Create `src/components/market/OrderForm.tsx` (presentational)
6. Create `src/components/market/TradingPanel.tsx` (stateful, wraps OrderForm, ports logic from TradePanel)
7. Create `src/components/market/VideoPane.tsx`
8. Create `src/components/market/MarketDetailLayout.tsx` (SWR polling shell)
9. Update `src/app/markets/[id]/page.tsx` to use MarketDetailLayout
10. Preserve `src/components/MarketLiveData.tsx` until MarketDetailLayout is confirmed working, then remove

**Success criteria:** Market detail shows split layout (video left, trading panel right), circular probability gauge, animated price ticker, view velocity sparkline, order form with YES/NO toggle and amount slider. All trades still function correctly (same Server Actions).

---

### Phase 4 — Portfolio Dashboard

**Dependencies:** Phase 1 complete.

1. Create `src/components/portfolio/PortfolioHeroCard.tsx`
2. Create `src/components/portfolio/ContractCard.tsx`
3. Create `src/components/portfolio/ActivityFeed.tsx`
4. Create `src/components/portfolio/PnLChart.tsx`
5. Create `src/components/portfolio/LeaderboardPreview.tsx`
   - Fetches top 5 from `/api/leaderboard` (already exists)
6. Rewrite `src/app/portfolio/page.tsx` — two-column layout
   - Left: PortfolioHeroCard + ContractCard grid
   - Right: PnLChart + ActivityFeed + LeaderboardPreview

**Success criteria:** Portfolio shows hero balance card with P&L, grid of open position cards with mini thumbnails, P&L chart, activity feed, leaderboard preview. SellButton still works.

---

### Phase 5 — Polish & Accessibility

**Dependencies:** All phases complete.

1. Hover states: verify 4px card lift on all GlassCard instances
2. Price number transitions: add `tabular-nums` + CSS `transition: all 0.3s ease` to ticker numbers
3. Live counter pulse: add `animate-pulse` class to dot on LiveViewCounter when polling
4. Responsive: test mobile breakpoints — sidebar should slide in/out via hamburger on <768px
5. Accessibility:
   - Focus rings on all interactive elements (`focus-visible:ring-2 focus-visible:ring-accent`)
   - ARIA labels on icon-only buttons (sidebar collapse, mute toggle)
   - Proper `<nav>` landmark in Sidebar
   - Color contrast check: muted text (#71717A) on #0A0A0A background → ~4.1:1 ✓
6. Performance:
   - Verify TikTokEmbed lazy loads (already uses `loading="lazy"` via native video)
   - Add `loading="lazy"` to all Image components in VideoCard thumbnails
   - Wrap FilterChips client island in Suspense

---

## Styling & Animation Specs

### Glassmorphic Card
```css
background: rgba(17, 17, 17, 0.8);
border: 1px solid rgba(255, 255, 255, 0.06);
border-radius: 16px;
backdrop-filter: blur(12px);
```

### Card Hover Lift
```css
transition: transform 200ms ease, border-color 200ms ease;
/* on hover: */
transform: translateY(-4px);
border-color: rgba(255, 255, 255, 0.12);
```

### Gradient Accent (CSS)
```css
background: linear-gradient(135deg, #00E5C0 0%, #8B5CF6 100%);
/* As text gradient: */
background-clip: text;
-webkit-background-clip: text;
color: transparent;
```

### Live Counter Pulse
```css
/* Tailwind: animate-pulse on the update dot */
/* Or use @keyframes for a number count-up animation on new value */
```

### Price Ticker Update Animation
```css
/* Use CSS transition on the numeric value */
/* Strategy: swap className between "text-green" and "text-red" based on price direction */
/* Add: transition: color 300ms ease */
```

### ProbabilityGauge SVG Arc
```
Circle r=40, cx=50, cy=50
strokeDasharray = probability * circumference
Stroke: linearGradient from #00E5C0 to #8B5CF6
Background stroke: #1E1E2E
Stroke-width: 8
Stroke-linecap: round
```

### Sidebar
```css
width: 240px; /* collapsed: 64px icon-only */
position: fixed;
left: 0; top: 0; bottom: 0;
background: #0D0D0D;
border-right: 1px solid rgba(255,255,255,0.06);
```

### Active Sidebar Item
```css
border-left: 2px solid;
border-image: linear-gradient(#00E5C0, #8B5CF6) 1;
/* Or: left border + text-accent, background rgba(0,229,192,0.08) */
```

---

## System-Wide Impact

### Interaction Graph

Layout change cascade:
- `layout.tsx` removes `<Navbar>` and adds `<AppShell>` → affects every page
- `AppShell` is a client component → adds one React hydration boundary at the root, but this is acceptable (Sidebar state must be interactive)
- Pages remain server components → no change to data fetching cascade
- `MarketLiveData` (SWR polling) is replaced by `MarketDetailLayout` → same SWR hooks, same poll interval, same data flow

### Error & Failure Propagation

- If `TradingPanel` (new) fails to render, it falls back to the same error boundary that wraps `MarketLiveData` (existing). No new error paths introduced.
- Hover-to-play in VideoCard: if `playUrl` is null (expected case for some markets), falls back gracefully to static thumbnail. No error thrown — conditional render.
- `ViewVelocitySparkline` receives empty `pollHistory` (new markets) — render nothing gracefully.

### State Lifecycle Risks

- `AppShell` sidebar state is local React state — not persisted. Sidebar is always open on fresh load. This is intentional (desktop-first).
- `VideoCard` hover-to-play: the `<video>` element is conditionally mounted on hover. Ensure `video.pause()` is called on `onMouseLeave` to prevent audio/network leak.
- `TradingPanel` ports all state from `TradePanel` unchanged — no new state risks.

### API Surface Parity

All API routes and Server Actions remain completely unchanged:
- `buyShares`, `previewTrade` in `src/lib/actions/trade.ts` — same signatures
- `/api/balance`, `/api/markets`, `/api/portfolio`, `/api/leaderboard` — unchanged
- `/api/tiktok/[videoId]/play-url` — unchanged, still used by TikTokEmbed

### Integration Test Scenarios

1. **Trade flow**: User hovers VideoCard → clicks → navigates to detail → places YES bet → balance updates in TopBar BalanceChip via SWR
2. **Price ticker update**: SWR poll fires on market detail → TradingPanel re-renders → PriceTickerDisplay shows animated delta
3. **Mobile sidebar**: On 375px viewport, sidebar is hidden → hamburger opens it → nav link clicked → sidebar closes, navigation occurs
4. **Empty portfolio**: New user with no positions — PortfolioHeroCard shows 1,000 coins, ContractCard grid shows empty state, ActivityFeed shows empty state
5. **Resolved market card**: VideoCard with `status: "resolved"` shows outcome badge instead of YES/NO price pills; hover-to-play still works

---

## Acceptance Criteria

### Functional Requirements

- [ ] All 5 nav items (Discover, Markets, Portfolio, Leaderboard, Activity) are accessible from the sidebar
- [ ] Wallet balance visible in TopBar, updates on SWR poll (same as current BalanceChip behavior)
- [ ] Home feed shows VideoCards with hover-to-play TikTok video preview (muted, 3-5s loop)
- [ ] Each VideoCard displays: view progress bar, YES/NO price pills, time remaining
- [ ] FilterChips filter the market grid (at minimum: All, and any available categories)
- [ ] Market detail split layout: video left (~60%), trading panel right (~40%)
- [ ] Circular probability gauge renders correct arc fill based on YES price
- [ ] Price ticker shows current YES price with animated delta on SWR update
- [ ] View velocity sparkline renders from pollHistory data
- [ ] Order form: YES/NO toggle, amount slider, presets, payout preview, Place Bet CTA
- [ ] buyShares Server Action still works correctly from new TradingPanel
- [ ] Portfolio hero card shows correct balance, open value, total value
- [ ] Contract position cards replace table rows with card grid
- [ ] P&L chart renders cumulative P&L from trade history
- [ ] SellButton still works from ContractCard

### Non-Functional Requirements

- [ ] Background: `#0A0A0A`, card: `#111111`, accent: `#00E5C0→#8B5CF6`
- [ ] All interactive cards have 4px lift hover transition
- [ ] Price numbers use `tabular-nums` font feature for stable layout
- [ ] Focus rings visible on all interactive elements (keyboard navigation)
- [ ] No confetti, no heavy particle effects
- [ ] Page layout is responsive — sidebar collapses on mobile
- [ ] Lazy loading on all video thumbnails (Image components)
- [ ] No new npm dependencies added (use lightweight-charts, SWR, existing stack only)

### Quality Gates

- [ ] `npm run build` passes with no TypeScript errors
- [ ] `npm run lint` clean
- [ ] Existing vitest tests pass (no backend changes, test surface unaffected)
- [ ] No `canvas-confetti` calls added

---

## Dependencies & Prerequisites

| Dependency | Status |
|---|---|
| Next.js 16.2 App Router | ✓ Present |
| React 19 | ✓ Present |
| Tailwind v4 | ✓ Present |
| SWR | ✓ Present |
| lightweight-charts v5 | ✓ Present |
| Inter font (next/font/google) | Needs import — zero new packages |
| New animation library | ✗ Not needed — CSS transitions only |
| Component library (shadcn etc.) | ✗ Explicitly excluded |

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Mitigation |
|---|---|---|
| AppShell client boundary causes hydration mismatch | Medium | Keep AppShell state-minimal; sidebar default state matches SSR |
| Hover-to-play video causes excessive network requests | Medium | Only fetch playUrl if already in props; don't re-fetch on hover |
| layout.tsx changes break admin routes | Low | Admin routes use their own `src/app/admin/layout.tsx` — verify it still wraps correctly inside AppShell |
| ProbabilityGauge SVG arc math edge cases (0%, 100%) | Low | Clamp input to [0.01, 0.99] range |
| Tailwind v4 gradient text via `bg-clip-text` | Low | Test in Chrome + Firefox; fallback to solid `text-accent` if needed |
| VideoCard hover-to-play audio leak | Medium | Always call `videoRef.current.pause()` in `onMouseLeave`, set `muted` attribute |

---

## Future Considerations

- **Sidebar collapse to icon-only**: Currently planned as full hide on mobile. A collapsed (64px) state for desktop could be added later.
- **Dark/Light mode toggle**: Design tokens are set up for it, but light mode is out of scope per spec.
- **Filter chips with real TikTok categories**: Currently hardcoded. Could be derived from `videoMetadata` tags once the data is available.
- **Animated number count-up**: Rolling number animation for the live view counter (like Robinhood's ticker) — out of scope for Phase 1 but trivially addable.

---

## Sources & References

### Internal References

- Color variables: `src/app/globals.css:1-13`
- Font declaration: `src/app/layout.tsx:5-8`
- TikTok video player: `src/components/TikTokEmbed.tsx`
- Existing trade logic (keep intact): `src/lib/actions/trade.ts`
- Price chart setup (lightweight-charts): `src/components/PriceChart.tsx:19-46`
- SWR polling pattern: `src/components/MarketLiveData.tsx` (reference, not modified)
- Current market card: `src/components/MarketCard.tsx`
- Current trade panel: `src/components/TradePanel.tsx`
- Admin layout (must remain functional): `src/app/admin/layout.tsx`

### Design References

- Phantom Wallet — dark glassmorphic cards, subtle gradient palette
- Polymarket — clean YES/NO market cards, probability gauges
- Robinhood Web — split trading layout, price ticker, portfolio dashboard
