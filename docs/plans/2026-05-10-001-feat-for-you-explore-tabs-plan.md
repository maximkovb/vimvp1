---
title: "feat: For You / Explore Tab Navigation"
type: feat
status: active
date: 2026-05-10
origin: docs/brainstorms/for-you-explore-tabs-requirements.md
---

# feat: For You / Explore Tab Navigation

## Summary

Add a TikTok-style "For You" / "Explore" tab bar to the mobile discover screen. Users can tap tabs or swipe horizontally to switch between the snap-scroll feed ("For You") and a grid browse view ("Explore"), with a smooth directional slide transition. Desktop layout is unchanged.

---

## Problem Frame

The feed and grid views are currently serial — users can only reach the grid by scrolling past every feed card. There is no labeled navigation, no gesture shortcut, and no way to jump to "browse mode" directly. The tab bar makes both modes co-equal, immediately discoverable, and navigable by gesture.

(see origin: docs/brainstorms/for-you-explore-tabs-requirements.md)

---

## Requirements

- R1. The top of the mobile discover screen displays two labeled tabs: "For You" on the left and "Explore" on the right.
- R2. A sliding underline indicator tracks the active tab.
- R3. *N/A — no existing `ModeToggleOverlay` exists in this codebase; the tab bar is net-new.*
- R4. The tab bar is visible regardless of which view is active.
- R5. Tapping a tab switches to that view.
- R6. Swiping left on "For You" switches to "Explore"; swiping right on "Explore" switches to "For You".
- R7. The transition is a horizontal slide — content slides in from the direction of the swipe.
- R8. Active tab persisted to `localStorage` key `cm_mobile_discover_mode`.
- R9. Explore view is a scrollable grid. Sort chips are deferred (see Scope Boundaries).
- R10. Vertical snap-scroll on the For You feed is unaffected by horizontal swipe.
- R11. Pull-to-refresh on Explore is deferred.

**Origin acceptance examples:** AE1 (covers R6, R7), AE2 (covers R6, R7), AE3 (covers R10), AE4 (covers R8)

---

## Scope Boundaries

- No third tab.
- No desktop layout changes — tab bar and pane-switcher are `md:hidden`.
- No sort chips in the Explore view at launch.
- No pull-to-refresh on the Explore view.
- `FeedEndGrid` at the end of the feed scroll is not removed — the Explore tab is additive.
- No changes to `FeedCard` behavior, `BetSheet`, or the bottom nav.

### Deferred to Follow-Up Work

- Sort chips (Trending, Ending Soon, High Vol, New) in the Explore view
- Pull-to-refresh on the Explore tab
- Removing `FeedEndGrid` from the feed end now that a dedicated Explore tab exists

---

## Context & Research

### Relevant Code and Patterns

- `src/components/DiscoverFeed.tsx` — current feed component; renders snap-scroll cards and `FeedEndGrid` inline at the end. Its internal `h-screen overflow-y-scroll snap-y snap-mandatory` container must continue to work inside the For You pane.
- `src/components/FeedEndGrid.tsx` — simple 2-column grid of `MarketCard`; the `ExploreGrid` follows the same shape as a standalone view.
- `src/components/MarketCard.tsx` — reused directly in `ExploreGrid`.
- `src/components/AppShell.tsx` — fixed bottom nav at 70px; Explore grid must account for this with `pb-[70px]`.
- `src/hooks/useScrollVelocity.ts` — scroll listener pattern (passive, stable ref). Horizontal swipe handlers should follow the same passive-listener + ref pattern.
- `src/app/globals.css` — Tailwind v4 tokens: `--safe-area-top`, `--safe-area-bottom`, color tokens. Tab bar must use `padding-top: var(--safe-area-top)` for iOS notch.
- `src/app/page.tsx` — current entry point; renders `<DiscoverFeed>` directly. Will be updated to render `<DiscoverTabView>`.

### Institutional Learnings

- `docs/solutions/ui-bugs/mobile-bet-tray-nav-clearance-fixes.md` — bottom nav is ~70px; content that scrolls must include matching `pb` to avoid nav overlap.
- `docs/solutions/runtime-errors/turbopack-instrumentation-worker-unref-kills-setinterval.md` — unref pattern in Next.js hooks. Not directly applicable but a reminder to clean up touch listeners in `useEffect` returns.

---

## Key Technical Decisions

- **Tab bar overlays content (not a layout shift):** Tab bar is `position: fixed; top: 0; z-50`. Feed cards remain `h-screen` — the tab bar floats over the top 48px of the first card, identical to TikTok's approach. No height recalculation needed on `DiscoverFeed`.
- **Two-pane container with `translateX`:** A flexbox row of two `100vw` panes shifts via `transform: translateX(0 | -100vw)`. CSS `transition: transform 0.3s ease-out` fires on tab tap or swipe release; transition is removed during active drag so animation tracks finger in real-time.
- **Axis detection for gesture disambiguation:** On `touchmove`, the first 8px of movement determines axis (|dx| vs |dy|). If horizontal, subsequent moves animate the pane and call `preventDefault()` to block vertical scroll. If vertical, the native scroll chain is undisturbed (R10, AE3). This matches the existing `useScrollVelocity` philosophy of listening passively and acting only when the event pattern matches.
- **Desktop unchanged:** `DiscoverTabView` renders `<DiscoverFeed>` directly inside a `hidden md:block` wrapper. Tab bar and pane container are `md:hidden`. Zero desktop regression risk.
- **localStorage values:** `'feed'` and `'grid'` (consistent with existing Clipmarket naming conventions). Defaults to `'feed'` when no stored value is found.

---

## Open Questions

### Resolved During Planning

- *Does the tab bar need to push down feed content?* No — overlay approach matches TikTok UX and requires no change to DiscoverFeed's internal layout.
- *What happens to FeedEndGrid?* Stays in the feed for now. Deferred cleanup.
- *Does page.tsx's `trendingIds` prop need to thread through?* Yes — `DiscoverTabView` accepts it and passes it down to `DiscoverFeed`. The existing disconnect between `page.tsx` and `DiscoverFeed`'s typed props is pre-existing and not in scope.

### Deferred to Implementation

- Exact tab bar height in px — `48px` is a starting point; adjust visually during implementation to match TikTok proportions and safe-area behavior on notched devices.
- Swipe velocity threshold (currently planned at 50px displacement or measurable velocity) — tune during implementation.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Mobile layout with tab bar active:**

```
┌──────────────────────────────────────┐
│  [safe-area-top]                     │  ← iOS notch padding
│  ┌──────────────────────────────────┐│
│  │  For You  │  Explore             ││  ← fixed tab bar, z-50
│  │  ────────                        ││  ← sliding underline
│  └──────────────────────────────────┘│
│                                      │
│  ┌─────────────┬─────────────┐       │
│  │  For You    │  Explore    │  …    │  ← two-pane row (200vw wide)
│  │  pane       │  pane       │       │     shifted by translateX
│  │  (active)   │             │       │
│  └─────────────┴─────────────┘       │
│                                      │
│  [bottom nav - 70px, fixed]          │
└──────────────────────────────────────┘
```

**Tab switch animation state machine:**

```
IDLE
  touchstart → record startX, startY → DETECTING

DETECTING
  touchmove (|dx| > |dy| AND |dx| > 8px) → axis=horizontal → DRAGGING
  touchmove (|dy| > |dx| AND |dy| > 8px) → axis=vertical   → IDLE (scroll passes through)

DRAGGING
  touchmove → update translateX in real-time (no transition CSS)
  touchend  → |dx| > 50px → commit tab switch (add transition CSS, snap to new tab) → IDLE
  touchend  → |dx| ≤ 50px → cancel (add transition CSS, snap back) → IDLE
```

---

## Implementation Units

- U1. **ExploreGrid component**

**Goal:** Standalone scrollable grid view for the Explore tab. Mirrors `FeedEndGrid` in data shape but is a proper independent view with correct spacing for the tab bar and bottom nav.

**Requirements:** R9

**Dependencies:** None

**Files:**
- Create: `src/components/ExploreGrid.tsx`

**Approach:**
- "use client" component (needs the `MarketCard` link interactions)
- Props: `gridMarkets: GridMarket[]` (same shape as `FeedEndGrid`'s prop)
- Renders a 2-column CSS grid (`grid-cols-2`) of `MarketCard` components
- Top padding: `pt-14` (accounts for the fixed tab bar ~48px + breathing room)
- Bottom padding: `pb-20` (accounts for bottom nav ~70px + breathing room)
- Horizontal padding: `px-3`
- Empty state: if `gridMarkets.length === 0`, render a simple centered "No markets yet" message

**Patterns to follow:**
- `src/components/FeedEndGrid.tsx` — same grid structure and `MarketCard` usage
- `src/components/MarketCard.tsx` — use directly, no changes needed

**Test scenarios:**
- Happy path: given 12 markets, grid renders 12 `MarketCard`s in 2 columns
- Edge case: given 0 markets, renders empty state message (not null)
- Edge case: given 1 market, renders a single card without layout breakage

**Verification:**
- Grid renders without layout overflow
- Cards are tappable and navigate to `/markets/[id]`
- No overlap with tab bar at top or bottom nav at bottom on iPhone SE (375px) and iPhone 15 Pro (393px)

---

- U2. **DiscoverTabView component**

**Goal:** Mobile-only wrapper that renders the tab bar with sliding underline and a two-pane container that switches between `DiscoverFeed` (For You) and `ExploreGrid` (Explore) via tap or swipe, with slide animation.

**Requirements:** R1, R2, R4, R5, R6, R7, R8, R10 / AE1, AE2, AE3, AE4

**Dependencies:** U1

**Files:**
- Create: `src/components/DiscoverTabView.tsx`

**Approach:**
- `"use client"` component
- **State:** `activeTab: 'feed' | 'grid'`, initialized from `localStorage.getItem('cm_mobile_discover_mode') ?? 'feed'`; any write to `activeTab` also writes to `localStorage`
- **Tab bar:** `position: fixed; top: 0; left: 0; right: 0; z-50`. Height ~48px + safe-area-top. Two text buttons ("For You", "Explore") centered. A white underline `div` transitions its `left` position between the two tab positions using `transition: left 0.3s ease-out`. Active tab text: `text-foreground font-semibold`. Inactive: `text-muted`. Background: subtle dark gradient (e.g., `bg-gradient-to-b from-black/60 to-transparent`) so feed content shows through.
- **Pane container:** `position: fixed; top: 0; bottom: 70px; left: 0; width: 200vw; display: flex`. Transform: `translateX(0)` for For You, `translateX(-50%)` for Explore (since container is 200vw, shifting by 50% shows the second pane). Note: on tab switch or swipe release, `transition: transform 0.3s ease-out` is applied for the snap animation; during active drag, the transition class is removed so the transform tracks the finger.
- **Touch gesture:** attach `onTouchStart`, `onTouchMove`, `onTouchEnd` to the pane container via `useRef` + `addEventListener` (passive: false for `touchmove` to allow `preventDefault()`). Track `startX`, `startY`, `axis: 'horizontal' | 'vertical' | null`, `dragging: boolean`. On horizontal drag, update pane `transform` in real-time. On release, commit or cancel based on |dx| threshold.
- **Desktop fallback:** `md:hidden` on the mobile tab layout; `hidden md:block` wrapper renders `<DiscoverFeed>` directly, unchanged.

**Technical design:** *(See High-Level Technical Design section above for the state machine and layout diagram.)*

**Patterns to follow:**
- `src/hooks/useScrollVelocity.ts` — passive/active listener lifecycle, ref-based callback pattern, cleanup in `useEffect` return
- `src/app/globals.css` — `var(--safe-area-top)`, `var(--safe-area-bottom)`, color tokens for tab bar styling

**Test scenarios:**
- Covers AE1. Happy path: on For You tab, swipe left 60px → Explore becomes active, underline slides right, pane slides in from right
- Covers AE2. Happy path: on Explore tab, swipe right 60px → For You becomes active, underline slides left, pane slides in from left
- Covers AE3. Edge case: on For You tab, swipe downward (dy > dx) → no tab switch, feed scroll proceeds normally
- Happy path: tap "Explore" label → switches to Explore view without gesture
- Happy path: tap "For You" label → switches to For You view without gesture
- Covers AE4. Happy path: `localStorage` has `'grid'` on mount → Explore tab is active initially
- Edge case: swipe 30px and release (below threshold) → pane snaps back to original tab with animation
- Edge case: swipe during open BetSheet — behavior should be unchanged (BetSheet sits above the pane container in z-order; swipe area is below the sheet)

**Verification:**
- Tab bar is visible on both For You and Explore views
- Tapping either tab switches the view with slide animation
- Swiping left/right switches views; vertical swipes on the feed do not trigger tab switch
- Active tab state is written to and read from `localStorage`
- No layout changes on desktop (≥ `md` breakpoint)

---

- U3. **page.tsx integration**

**Goal:** Wire `DiscoverTabView` into the home page so it replaces the direct `DiscoverFeed` render.

**Requirements:** R1, R4, R5, R6 (entry point that makes all tab behavior reachable)

**Dependencies:** U1, U2

**Files:**
- Modify: `src/app/page.tsx`

**Approach:**
- Replace `import { DiscoverFeed }` with `import { DiscoverTabView }`
- Replace `<DiscoverFeed feedMarkets gridMarkets pollData trendingIds />` with `<DiscoverTabView feedMarkets gridMarkets pollData trendingIds />`
- `DiscoverTabView` accepts the same props and passes them to the appropriate child (`DiscoverFeed` for For You, `ExploreGrid` for Explore)
- No server-side data changes needed — `gridMarkets` is already computed in `page.tsx`

**Patterns to follow:**
- Current `src/app/page.tsx` prop shape

**Test scenarios:**
- Happy path: home page renders with tab bar visible on mobile (DevTools mobile viewport)
- Happy path: home page at desktop width shows `DiscoverFeed` without tab bar
- Integration: navigating to `/` after having visited with Explore active (stored in localStorage) loads with Explore tab selected

**Verification:**
- `tsc --noEmit` passes with no new type errors
- Home page renders feed cards as before when For You is active
- Home page renders market grid when Explore is active

---

## System-Wide Impact

- **Interaction graph:** `page.tsx` → `DiscoverTabView` (new) → `DiscoverFeed` (unchanged) or `ExploreGrid` (new). `BetSheet` is rendered inside `DiscoverFeed` and is unaffected by the pane container's transform. The pane container's `position: fixed` means the `BetSheet` (which uses a portal/vaul) renders above it in z-order without conflict.
- **Error propagation:** No new error paths. `ExploreGrid` is a pure presentational component; any data errors surface at the `page.tsx` server-fetch level as before.
- **State lifecycle risks:** `localStorage` read happens at component mount. On SSR, `localStorage` is unavailable — the initial render must default to `'feed'` safely (no `localStorage` read during SSR). Use `useEffect` or lazy initialization inside `useState` to guard this. Matches the `useScrollVelocity` pattern of no SSR-sensitive state.
- **API surface parity:** No API changes. `page.tsx` queries are unchanged.
- **Unchanged invariants:** `DiscoverFeed` internal behavior (snap-scroll, `IntersectionObserver`, `BetSheet`, `useScrollVelocity`, `FeedEndGrid` at scroll end) is entirely unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Horizontal swipe on feed interferes with native iOS momentum scroll on snap-scroll cards | Axis detection guards: only call `preventDefault()` when `abs(dx) > abs(dy)`. Vertical touch events are never consumed. |
| Tab bar covers the top of FeedCard content (gradient, trending badge) | FeedCard already has a dark gradient overlay at the top. Tab bar uses semi-transparent gradient background. Adjust badge positioning (`top-12` instead of `top-0`) if overlap looks bad during implementation. |
| `localStorage` read on SSR throws | Guard with `typeof window !== 'undefined'` or use `useEffect` initialization. |
| `position: fixed` pane container conflicts with AppShell on some browsers | AppShell is a flex container, not a transform context. `fixed` positioning is relative to the viewport, not AppShell. No known conflict. |

---

## Sources & References

- **Origin document:** [docs/brainstorms/for-you-explore-tabs-requirements.md](docs/brainstorms/for-you-explore-tabs-requirements.md)
- Related code: `src/components/DiscoverFeed.tsx`, `src/components/FeedEndGrid.tsx`, `src/components/AppShell.tsx`
- Related plans: `docs/plans/2026-04-04-002-feat-mobile-first-doomscroll-ui-plan.md` — established the feed + AppShell architecture this plan extends
- Related solutions: `docs/solutions/ui-bugs/mobile-bet-tray-nav-clearance-fixes.md`
