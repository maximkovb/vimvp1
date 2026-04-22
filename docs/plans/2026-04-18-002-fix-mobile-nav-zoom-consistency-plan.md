---
title: Fix Mobile Navigation Zoom Consistency
type: fix
status: completed
date: 2026-04-18
origin: docs/brainstorms/2026-04-18-mobile-nav-zoom-requirements.md
---

# Fix Mobile Navigation Zoom Consistency

## Overview

On mobile, navigating between app sections causes the browser to zoom inconsistently. The Leaderboard page is the primary trigger: its 7-column table has no horizontal-scroll container, so iOS Safari zooms the entire viewport out to fit the wide content. That zoomed-out scale persists when the user navigates to other pages (My Bets, Portfolio), requiring a manual pinch-to-zoom-in to restore the expected layout.

## Problem Statement

**Root cause:** `src/app/leaderboard/page.tsx` wraps its table in `overflow-hidden` with no inner `overflow-x-auto`. The table's 7 columns produce a minimum layout width that exceeds 375px. iOS Safari responds by shrinking the viewport scale (zoom out) to make the content fit — and that scale is sticky across route navigations.

**Why Discover and Profile are fine:** Discover renders single-column cards; Profile uses `max-w-lg` with simple form elements. Neither page generates content wider than the device viewport.

**Why My Bets and Portfolio appear affected even though they have `overflow-x-auto`:** The zoom level set by the Leaderboard visit persists. My Bets and Portfolio don't reset the browser's scale on navigation. Once Leaderboard is fixed, those pages should behave correctly too.

**Confirmed state per-page:**
| Page | Has `overflow-x-auto`? | Columns | Status |
|---|---|---|---|
| Leaderboard | ❌ No | 7 | **Broken — primary cause** |
| History (My Bets) | ✅ Yes | 6 | Likely OK once Leaderboard fixed |
| Portfolio (active) | ✅ Yes | 7 | Likely OK once Leaderboard fixed |
| Portfolio (resolved) | ✅ Yes | 7 | Likely OK once Leaderboard fixed |
| Discover | n/a | — | Unaffected |
| Profile | n/a | — | Unaffected |

## Proposed Solution

Two changes, in order of impact:

### Change 1 — Fix Leaderboard table overflow (primary fix)

`src/app/leaderboard/page.tsx`

Add an `overflow-x-auto` wrapper inside the existing `overflow-hidden` container, matching the established pattern used in History and Portfolio. Since 7 columns is too many for comfortable horizontal scrolling on a 375px screen, also hide lower-priority columns on mobile using `hidden sm:table-cell`:

- **Always visible (mobile):** Rank, Trader, Total Value
- **Hidden on mobile, visible sm+:** Balance, Positions, Win Rate, Streak

With only 3 columns on mobile, the table fits 375px without needing to scroll — the `overflow-x-auto` wrapper is added as a defensive measure in case columns are added in the future.

(see origin: docs/brainstorms/2026-04-18-mobile-nav-zoom-requirements.md — "Prefer overflow-x-auto over column hiding unless table has 6+ columns where scrolling is impractical"; Leaderboard has 7 columns, so column-hiding is the recommended path.)

### Change 2 — Global overflow safety net (defensive fix)

`src/app/globals.css`

Add `overflow-x: hidden` to `html` (not `body` — applying to `body` breaks `position: fixed` on iOS Safari, which would break the bottom nav). This prevents any future page-level horizontal overflow from forcing viewport zoom, regardless of which page is visited.

```css
html {
  overflow-x: hidden;
}
```

> **Note:** `overflow-x: hidden` on `html` does NOT interfere with inner `overflow-x: auto/scroll` containers — those still scroll correctly.

## Technical Considerations

- **`overflow-hidden` vs `overflow-x-auto` interaction:** The outer `rounded-xl overflow-hidden` div (present on all table cards) exists for visual border-radius clipping. The inner `overflow-x-auto` div enables horizontal scroll for the table. Both can coexist — History and Portfolio already demonstrate this pattern correctly.
- **`hidden sm:table-cell` for column hiding:** Applied to BOTH `<th>` and all corresponding `<td>` elements in each row to maintain table alignment. If only applied to `<th>`, the data cells will still render and misalign the grid.
- **`min-w-0` on flex children:** The `BottomNavClient` already uses `min-w-0` and `truncate`, so the nav bar itself does not contribute to overflow.
- **iOS `position: fixed` and `overflow-x: hidden`:** Setting `overflow-x: hidden` on `body` is a known iOS Safari bug trigger that causes `position: fixed` elements to scroll with the page. Setting it on `html` instead avoids this. The bottom nav in `AppShell` is `position: fixed`, so the `html`-only approach is critical.

## System-Wide Impact

CSS/JSX layout-only changes — no component re-renders, no API calls. Manual verification needed: viewport test at 375px across all 5 nav tabs; confirm column visibility and alignment at `sm` breakpoint (640px) on desktop.

## Acceptance Criteria

- [ ] Navigating Discover → Leaderboard → My Bets → Portfolio → Profile → Discover on a 375px-wide device shows a consistent zoom level throughout (no nav bar size change between pages).
- [ ] The Leaderboard page renders 3 columns on mobile (Rank, Trader, Total Value) and all 7 columns on `sm` and above.
- [ ] The Leaderboard table's `<th>` and `<td>` hidden columns are hidden in sync — no misaligned empty columns.
- [ ] History and Portfolio tables remain horizontally scrollable as before (regression check).
- [ ] No manual pinch-to-zoom-out is required on any page at standard mobile viewport width.
- [ ] Desktop layout is unaffected.
- [ ] The bottom nav does not scroll with content (iOS `position: fixed` regression check).

## Dependencies & Risks

- **Low risk overall** — changes are CSS/JSX layout only, no data or API changes.
- **Risk: Hiding wrong columns.** If `hidden sm:table-cell` is applied to `<th>` but not the matching `<td>` (or vice versa), the column appears blank instead of hidden. Verify alignment after changes.
- **Risk: `overflow-x: hidden` on `html` may clip legitimately wide content.** No other page currently uses content wider than the viewport intentionally. This is a safe addition.

## Implementation Order

1. `src/app/globals.css` — Add `html { overflow-x: hidden; }` (1 line, zero risk)
2. `src/app/leaderboard/page.tsx` — Add `overflow-x-auto` wrapper + `hidden sm:table-cell` on 4 columns (both `<th>` and `<td>`)
3. Verify in browser at 375px: navigate all 5 tabs, confirm consistent zoom

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-18-mobile-nav-zoom-requirements.md](../brainstorms/2026-04-18-mobile-nav-zoom-requirements.md)
  Key decisions carried forward: (1) fix content width rather than suppress user zoom, (2) hide columns on Leaderboard since 7 cols > threshold for practical horizontal scroll, (3) `overflow-x-auto` is the consistent pattern established by History and Portfolio
- Leaderboard page: `src/app/leaderboard/page.tsx:89`
- History page (reference implementation of correct pattern): `src/app/history/page.tsx:35-36`
- Portfolio page (reference implementation): `src/app/portfolio/page.tsx:138-139`
- AppShell (bottom nav fixed positioning): `src/components/AppShell.tsx:23-27`
- Globals CSS: `src/app/globals.css`
