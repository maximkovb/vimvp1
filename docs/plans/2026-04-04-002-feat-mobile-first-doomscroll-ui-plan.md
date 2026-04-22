---
title: "feat: Mobile-First Doomscroll UI Overhaul"
type: feat
status: completed
date: 2026-04-04
origin: docs/brainstorms/2026-04-04-mobile-first-ui-overhaul-requirements.md
---

# feat: Mobile-First Doomscroll UI Overhaul

## Overview

Replace the existing desktop-first card grid and top navbar with a TikTok-style vertical snap-scroll feed on mobile and a left-sidebar + centered feed column layout on desktop. All original market functionality is preserved. The primary interaction change is: users discover markets by scrolling full-screen cards, and place bets through a slide-up bottom sheet without leaving the feed.

---

## Problem Statement

The current UI has no mobile-specific patterns. On mobile, the nav links are hidden entirely (only logo + avatar visible), the market grid is cramped, and betting requires navigating away to a detail page. The product's core loop — discover a market, assess it quickly, place a bet — has unnecessary friction on the platform where the majority of users will access it.

(see origin: docs/brainstorms/2026-04-04-mobile-first-ui-overhaul-requirements.md)

---

## Proposed Solution

Five self-contained implementation phases, each shippable independently:

1. **Navigation shell** — replace `Navbar` with `BottomNav` (mobile) + `Sidebar` (desktop)
2. **`TradePanel` initialOutcome prop** — prerequisite one-liner for the bet sheet
3. **Doomscroll feed** — snap-scroll `FeedCard` list + `FeedEndGrid` transition
4. **Bet sheet** — `vaul` Drawer wrapping `TradePanel`, triggered from feed cards
5. **Profile page + polish** — stub `/profile`, safe-area insets, admin affordance

---

## Technical Considerations

### Architecture

**Navbar removal:** `Navbar` is a server async component that calls `auth()` + DB. The replacement components (`BottomNav`, `Sidebar`) should also be server components — they receive `session` and `initialBalance` from the root layout server context, then pass them as props to thin client islands (`BottomNavClient`, `SidebarClient`) for active-tab highlighting via `usePathname`. This preserves the existing auth + balance pattern without needing a `/api/balance` fetch from a client component.

**Root layout restructure:** `layout.tsx` changes from `<Navbar /> + <main>` to an `AppShell` server component that renders `<Sidebar>` + `<div className="flex-1">` (with `<BottomNav>` fixed at bottom on mobile). `AppShell` does the `auth()` + balance DB call once, then passes the data down.

**CSS scroll-snap feed:** Pure CSS, no JS library. The feed container gets `overflow-y-scroll snap-y snap-mandatory h-screen`. Each card is `snap-start h-screen`. No horizontal scrolling, no page navigation. The `FeedEndGrid` is a final non-snap section that appears after all cards.

**Bottom sheet:** Install `vaul` (MIT, ~3kb, built for Next.js, native drag-to-dismiss). On desktop, the sheet is rendered inside the 390px feed column (not a full-viewport portal) to avoid covering the sidebar. On mobile, full-width sheet. `vaul`'s `Drawer.Root` supports a `container` prop for this.

**Body scroll lock:** While the bet sheet is open, add `overflow-hidden` to `document.body` via a `useEffect` in the sheet component to prevent the snap-scroll feed from scrolling behind the sheet on iOS Safari.

### Key Constraints

- **Tailwind v4** — no `tailwind.config.js`. All new tokens go in `globals.css` under `:root` and `@theme inline`. Utility classes like `snap-y`, `snap-mandatory`, `snap-start` work as-is.
- **React 19 / Next.js 16** — server actions in `TradePanel` (`buyShares`, `previewTrade`) continue to work unchanged inside the sheet. No API route changes needed.
- **`lightweight-charts` resize:** `PriceChart` inside the bet sheet must observe container resize with a `ResizeObserver`, not just a `window` resize listener. See `docs/solutions/integration-issues/lightweight-charts-v5-typescript-utctimestamp-integration.md`.
- **Concurrent trade errors:** `buyShares` can throw `ConcurrentTradeError` (optimistic lock retry). `TradePanel`'s existing `isPending` state and error display handle this; no changes needed. See `docs/solutions/database-issues/nextjs-financial-app-code-review-patterns.md`.

### Performance

- Feed card thumbnails: use Next.js `<Image>` with `fill` + `priority` on the first visible card, `loading="lazy"` on the rest.
- The initial server fetch already loads up to 50 markets. The `FeedEndGrid` uses this same data — no second fetch needed.

---

## System-Wide Impact

### Interaction Graph

`layout.tsx` (AppShell) → `auth()` + DB balance query → `Sidebar` / `BottomNav` (server) → `SidebarClient` / `BottomNavClient` (client, `usePathname`) → active tab highlighting. No callbacks fire on navigation.

`FeedCard` (client) → user taps YES/NO → `BetSheet` opens → `TradePanel` → `buyShares` (server action) → DB write → `onTradeSuccess` callback → sheet auto-dismisses → `BalanceChip` refetches balance via SWR mutation.

### Error Propagation

- `buyShares` returns `{ error: string }` on failure (including auth errors and concurrent trade errors). `TradePanel` surfaces this in its existing error display. No new error paths needed.
- Unauthenticated users who tap YES/NO: the sheet opens, `TradePanel` renders normally, and `buyShares` returns `{ error: "Not authenticated" }` on submit. This matches the existing detail-page behavior. No redirect on sheet open.

### State Lifecycle Risks

- Feed scroll position must be preserved when the sheet opens and closes. Achieved by: `overflow-hidden` on `<body>` while sheet is open (prevents scroll drift on iOS), and restoring it on close.
- Feed card `prices` are passed from the server-rendered homepage. They are static until the page is refreshed. This is unchanged from current behavior.

### API Surface Parity

- All existing routes (`/markets/[id]`, `/portfolio`, `/history`, `/leaderboard`, `/admin`) remain unchanged. Only their shared chrome (navbar) changes.
- `TradePanel` receives a new optional `initialOutcome` prop. Default is `0` (YES), so all existing usages in `MarketLiveData` are unaffected.

### Integration Test Scenarios

1. **Unauthenticated user scrolls feed → taps NO → sheet opens → submits trade → sees error** — confirm error is shown inside sheet, not a redirect.
2. **Authenticated user trades → `onTradeSuccess` fires → sheet auto-dismisses → feed card still visible at same scroll position**.
3. **Desktop user at 1440px width → sidebar visible, feed column centered at ~390px → sheet opens → sheet is constrained to feed column, does not cover sidebar**.
4. **Feed reaches last card → grid overview renders inline without navigation → all markets visible → user taps a grid card → navigates to `/markets/[id]`**.
5. **Admin user on desktop → sidebar shows "+ Create Market" link → navigates to `/admin/markets/new`**.

---

## Acceptance Criteria

### Functional

- [ ] **R1** Mobile and desktop home page shows a vertical full-screen snap-scroll feed instead of the card grid
- [ ] **R2** Each feed card: full-bleed thumbnail background, gradient overlay, creator @username + caption, YES/NO buttons at bottom with current prices, circular progress ring (views or likes vs. milestone target) top-right, "Trending" badge on top 3 most-recently-created active markets
- [ ] **R3** After the last feed card, a grid overview of all markets appears inline (no navigation, no reload)
- [ ] **R4** Tapping anywhere on a feed card opens the bet sheet; tapping YES/NO pre-selects that side; sheet is draggable to dismiss; feed stays dimmed behind it; feed scroll position is preserved on dismiss
- [ ] **R5** On mobile (< `md`), a fixed bottom nav bar shows 5 tabs: Discover, My Bets, Leaderboard, Portfolio, Profile; top navbar is not shown
- [ ] **R6** On desktop (≥ `md`), a fixed left sidebar shows the same 5 tabs plus balance chip and sign-in/sign-out; top navbar is not shown
- [ ] **R7** Tab routes: Discover→`/`, My Bets→`/history`, Leaderboard→`/leaderboard`, Portfolio→`/portfolio`, Profile→`/profile`
- [ ] **R8** All existing pages (`/markets/[id]`, `/portfolio`, `/history`, `/leaderboard`, `/admin`) render correctly with the new navigation chrome
- [ ] **R9** On desktop, feed column is ~390px wide and centered to the right of the sidebar

### Non-Functional

- [ ] Halted and resolving markets appear in the feed with YES/NO buttons visually disabled and a status badge; bet sheet does not open for these cards
- [ ] Unauthenticated users can scroll the feed and open the bet sheet; they see the `TradePanel` and get an error on submit (no redirect on sheet open)
- [ ] iOS Safari: feed does not scroll behind an open bet sheet
- [ ] `PriceChart` inside the bet sheet resizes correctly when the sheet expands/collapses
- [ ] Admin users see a "+ Create Market" link in the sidebar (desktop) or somewhere accessible on mobile

### Quality Gates

- [ ] No TypeScript errors (`tsc --noEmit` passes)
- [ ] No new ESLint errors
- [ ] Existing `/markets/[id]` page still fully functional on both mobile and desktop
- [ ] `TradePanel` usage in `MarketLiveData` still works (no regression from `initialOutcome` prop addition)

---

## Implementation Phases

### Phase 1 — Navigation Shell

**Goal:** Replace `Navbar` with `BottomNav` + `Sidebar`. All existing routes work with new chrome.

**Files to create:**
- `src/components/BottomNavClient.tsx` — `"use client"`, uses `usePathname()` for active tab, renders 5 tabs as links. Receives `session: Session | null` as prop.
- `src/components/SidebarClient.tsx` — `"use client"`, uses `usePathname()` for active tab, renders logo + 5 tabs + `BalanceChip` + sign-in/out. Receives `session` and `initialBalance` as props.
- `src/components/AppShell.tsx` — server async component, calls `auth()` + DB balance query, renders `SidebarClient` (hidden on mobile) + `BottomNavClient` (hidden on desktop) + `{children}`. Adds safe-area bottom padding to bottom nav.

**Files to modify:**
- `src/app/layout.tsx` — replace `<Navbar /><main>` with `<AppShell>{children}</AppShell>`

**Files to delete:**
- `src/components/Navbar.tsx` — after confirming no other imports

**Notes:**
- Active tab: `usePathname()` returns e.g. `/history`. Match exactly for `Discover` (`pathname === "/"`), prefix match for others.
- Admin "+ Create Market" button: add to bottom of `SidebarClient`, conditionally rendered when `session?.user` is admin.
- `UserMenu` currently links to `/profile` (broken). This is fixed in Phase 5.

---

### Phase 2 — TradePanel `initialOutcome` Prop

**Goal:** Allow the bet sheet to pre-select YES or NO based on which button the user tapped.

**Files to modify:**
- `src/components/TradePanel.tsx`
  - Add `initialOutcome?: number` to `TradePanelProps` interface
  - Change `useState<number>(0)` to `useState<number>(initialOutcome ?? 0)`
  - No other changes — all existing usages default to `0` (YES) and are unaffected

**Acceptance:** `<TradePanel marketId="x" prices={[...]} initialOutcome={1} />` opens with NO pre-selected.

---

### Phase 3 — Doomscroll Feed

**Goal:** Replace the home page market grid with a full-screen snap-scroll feed.

**Files to create:**
- `src/components/FeedCard.tsx` — `"use client"` (needs onClick handler). Props: same as `MarketCard` plus `onTap(initialOutcome?: number): void`. Renders:
  - Full-bleed `<Image>` background (thumbnail) with dark gradient overlay
  - Top-right: SVG circular progress ring. Data: `tiktokPolls` latest `viewCount` (or `likeCount` if `questionType === "likes"`) vs `milestoneThreshold`. **Note:** If current view/like count is not available in the market row, show the ring with 0% fill and a "—" label. This is deferred to planning for the data model question (see Outstanding Questions).
  - Top-left: "Trending" badge for the 3 most recently created active markets
  - Status badge for halted/resolving markets (replaces Trending badge position)
  - Bottom: `@channelTitle`, market title (caption), YES/NO pill buttons
  - YES/NO buttons: call `onTap(0)` / `onTap(1)`. Disabled (grayed, `pointer-events-none`) if market is halted/resolving.
  - Tapping anywhere else on the card: calls `onTap()` (no pre-selection, `initialOutcome` is `undefined`)

- `src/components/FeedEndGrid.tsx` — `"use client"`. Receives `gridMarkets` (active + resolved). Renders a `grid grid-cols-2 sm:grid-cols-3` of `MarketCard` components. Shown after last snap card.

- `src/components/DiscoverFeed.tsx` — `"use client"`. Props: `feedMarkets` (active/halted/resolving, for snap cards) and `gridMarkets` (all markets including resolved, for the end grid). Renders:
  ```
  <div className="h-screen overflow-y-scroll snap-y snap-mandatory" style={{ scrollbarWidth: 'none' }}>
    {feedMarkets.map(m => <div className="snap-start h-screen"><FeedCard ... /></div>)}
    <div className="snap-start min-h-screen pt-8 px-4"><FeedEndGrid gridMarkets={gridMarkets} /></div>
  </div>
  ```

**Files to modify:**
- `src/app/page.tsx` — replace `<MarketGrid>` and `<ResolvingRailCard>` grid with `<DiscoverFeed feedMarkets={[...resolvingSoon, ...mainMarkets]} gridMarkets={[...activeMarkets, ...resolvedMarkets]} />`. Resolving-soon cards appear first in the feed with their status badge.

**Data note:** The "views vs target" ring requires the current view/like count. Check if `videoMetadata` JSON stores this or if `tiktokPolls` rows are needed. If unavailable on the market row, the ring renders empty (acceptable MVP; ring data can be added in a follow-up).

---

### Phase 4 — Bet Sheet

**Goal:** Tapping a feed card opens a slide-up `TradePanel` sheet without leaving the feed.

**Install:** `vaul` — `npm install vaul`

**Files to create:**
- `src/components/BetSheet.tsx` — `"use client"`. Uses `vaul`'s `Drawer.Root` + `Drawer.Content`. Props: `{ open, onOpenChange, marketId, prices, initialOutcome, title }`. Renders:
  - Drag handle at top
  - Market title (header)
  - `<TradePanel marketId prices initialOutcome onTradeSuccess={handleSuccess} />`
  - `handleSuccess`: waits 1.5s showing a success state, then calls `onOpenChange(false)`
  - On open: `document.body.style.overflow = 'hidden'`; on close: restore
  - On desktop: pass `container` prop pointing to the feed column ref (constrains sheet to 390px column)

**Files to modify:**
- `src/components/DiscoverFeed.tsx` — add `BetSheet` state. `FeedCard.onTap(initialOutcome)` → set `{ sheetOpen: true, activeMarketId, initialOutcome }`.
- `src/components/FeedCard.tsx` — pass `onTap` handler through (already planned in Phase 3).

**Notes:**
- The dim overlay is provided by `vaul`'s built-in backdrop.
- On desktop, `Drawer.Content` must be positioned inside the feed column. Use a `ref` on the column `div` and pass it to `Drawer`'s `container` prop.

---

### Phase 5 — Profile Page + Polish

**Goal:** Create the missing `/profile` page; apply safe-area insets for iOS; minor cleanup.

**Files to create:**
- `src/app/profile/page.tsx` — server async component. Calls `auth()`, redirects to `/auth/signin` if no session. Renders: display name, email, current balance, sign-out button (`UserMenu` can be reused or a simple form action). This resolves the broken `/profile` link in `UserMenu`.

**Files to modify:**
- `src/app/layout.tsx` — add `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />` inside `<head>` for iOS safe-area support.
- `src/app/globals.css` — add safe-area tokens:
  ```css
  :root {
    --safe-area-bottom: env(safe-area-inset-bottom, 0px);
    --safe-area-top: env(safe-area-inset-top, 0px);
  }
  ```
  Apply `padding-bottom: var(--safe-area-bottom)` to bottom nav, `padding-top: var(--safe-area-top)` to top of `AppShell` content area.

---

## Alternative Approaches Considered

(see origin: docs/brainstorms/2026-04-04-mobile-first-ui-overhaul-requirements.md — Key Decisions)

- **Page navigation instead of bet sheet:** Tapping a card would navigate to `/markets/[id]`. Rejected — breaks doomscroll flow; user loses feed position.
- **Grid layout on desktop:** Desktop keeps the current 3-column grid; mobile gets the doomscroll feed. Rejected — inconsistent experience, more code to maintain.
- **Full-viewport bet sheet on desktop:** Easier to implement but looks wrong on wide screens (sheet covers sidebar). Rejected in favor of column-constrained sheet.
- **Framer Motion for bottom sheet:** More flexible but heavier (~30kb). `vaul` is purpose-built for this pattern and much smaller.

---

## Outstanding Questions

### Resolved by Plan

- ✅ **Unauthenticated trade flow:** Sheet opens, TradePanel renders, error on submit. No redirect on sheet open.
- ✅ **`initialOutcome` prop:** Add to TradePanel (Phase 2).
- ✅ **`/profile` page:** Stub created in Phase 5.
- ✅ **BalanceChip placement:** Sidebar on desktop (inside `SidebarClient`). Not shown in bottom nav (no space). Not shown on mobile.
- ✅ **Halted markets in feed:** Included with disabled YES/NO buttons and status badge.
- ✅ **Trending badge:** Top 3 most recently created active markets (sorted by `createdAt desc`, first 3 get the badge). No schema change.
- ✅ **Desktop sheet width:** Constrained to 390px feed column via `vaul`'s `container` prop.
- ✅ **Post-trade sheet behavior:** 1.5s inline success state → auto-dismiss.
- ✅ **Admin Create Market:** In sidebar (desktop-only, conditionally rendered).
- ✅ **"My Bets" → `/history`:** Intentional mapping (My Bets = trade history). Label is acceptable.

### Deferred (Needs Investigation Before Coding)

- **[Affects Phase 3][Data model]** Does the market row (or an associated table) store the current `viewCount`/`likeCount` for the circular progress ring? Check `src/db/schema.ts` for `tiktokPolls` join or a `currentViews` field on the `markets` table. If not joinable at page-query level, the ring renders empty for MVP.
- **[Affects Phase 4][vaul API]** Confirm `vaul` v0.x `Drawer.Root` supports a `container` prop for in-column rendering. If not, fall back to CSS `transform: translateX` scoped to the column.
- **[Affects Phase 1][Mobile profile link]** Confirm that `UserMenu` (which currently links to `/profile`) is no longer shown on mobile after the bottom nav replaces the navbar. If `UserMenu` persists anywhere, the broken link is fixed by Phase 5.
- **[Affects Phase 4][Scope]** Does the bet sheet include a price chart? If yes, `BetSheet` must either fetch price history itself (new data dependency, likely via SWR against `/api/markets/[id]`) or receive it as a prop from `DiscoverFeed`. For MVP, the sheet is `TradePanel`-only; chart can be added as a follow-up once the data source is confirmed.
- **[Affects Phase 4][Scope]** Does the bet sheet include sell controls (`SellButton`)? `SellButton.tsx` is separate from `TradePanel` and requires the user's current share position — data not available in the feed context without an additional fetch. Recommend excluding sell from the sheet for MVP; sell remains accessible via `/markets/[id]`.

---

## Dependencies

- `vaul` package (new install, ~3kb gzipped)
- No DB schema changes
- No new API routes
- No changes to existing server actions

---

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| iOS Safari scroll-behind-sheet | High | Medium | Body scroll lock in `BetSheet` open/close lifecycle |
| `PriceChart` wrong size in sheet | High | Low | Apply `ResizeObserver` on sheet content container (existing solution documented) |
| `vaul` container prop not supported | Low | Low | Fall back to CSS-scoped positioning in the feed column |
| Feed scroll position lost on sheet dismiss | Medium | Medium | Test with `overflow-hidden` scroll lock; verify snap position is maintained |
| `Navbar` import elsewhere (tests, stories) | Low | Low | `grep -r "Navbar"` before deleting |

---

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-04-04-mobile-first-ui-overhaul-requirements.md](docs/brainstorms/2026-04-04-mobile-first-ui-overhaul-requirements.md)
  Key decisions carried forward: (1) slide-up bet sheet over page navigation; (2) hybrid feed→grid after last card; (3) left sidebar replaces top navbar on desktop.

### Internal References

- Current navbar: `src/components/Navbar.tsx`
- TradePanel (to modify): `src/components/TradePanel.tsx:13` — `TradePanelProps` interface
- MarketLiveData (existing TradePanel usage): `src/components/MarketLiveData.tsx`
- BalanceChip: `src/components/BalanceChip.tsx`
- UserMenu: `src/components/UserMenu.tsx` — links to `/profile` (currently broken)
- PriceChart: `src/components/PriceChart.tsx` — needs ResizeObserver in sheet context
- Home page server component: `src/app/page.tsx`
- Root layout: `src/app/layout.tsx`
- Global CSS (Tailwind v4): `src/app/globals.css`

### Institutional Learnings

- `docs/solutions/integration-issues/lightweight-charts-v5-typescript-utctimestamp-integration.md` — ResizeObserver required for charts inside sheets/collapsible panels
- `docs/solutions/database-issues/nextjs-financial-app-code-review-patterns.md` — ConcurrentTradeError is handled in TradePanel's existing error state; no UI change needed

### External References

- [vaul — Accessible Drawer for React](https://vaul.emilkowal.ski/) — bottom sheet library
- [CSS Scroll Snap — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll_snap) — native scroll-snap API
- [Tailwind v4 docs — Theme configuration](https://tailwindcss.com/docs) — v4 uses `@theme inline {}` in CSS, not `tailwind.config.js`
