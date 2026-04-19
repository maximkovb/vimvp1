---
date: 2026-04-18
topic: mobile-nav-zoom
---

# Mobile Navigation Zoom Consistency

## Problem Frame

On mobile, navigating between sections causes an inconsistent zoom level. Pages with wide tables (Leaderboard, My Bets/History, Portfolio) cause iOS Safari to zoom out to fit content wider than the viewport. That zoom level persists when the user navigates to other pages, making layout appear shifted until the user manually resets zoom. Discover and Profile are unaffected because they have single-column, naturally narrow layouts.

## Root Cause

- **Leaderboard** (`/leaderboard`): 7-column table inside `overflow-hidden` with no horizontal scroll — content overflows at mobile widths, triggering browser zoom-to-fit.
- **My Bets / History** (`/history`): has `overflow-x-auto` on the table but `whitespace-nowrap` cells may still force effective page width past `100vw`.
- **Portfolio** (`/portfolio`): similar wide-table layout.
- Viewport meta tag is correctly set (`width=device-width, initial-scale=1`) — the problem is content, not the meta tag.

## Requirements

- R1. No page in the app should render content wider than `100vw` at `initial-scale=1` on a standard mobile viewport (375px).
- R2. The Leaderboard table must be horizontally scrollable on mobile (inside a proper `overflow-x-auto` container), OR less-critical columns must be hidden on mobile to keep the table within viewport width.
- R3. The History (My Bets) and Portfolio tables must be confirmed to stay within viewport width — fix any `whitespace-nowrap` or fixed-width elements that cause overflow.
- R4. Navigating between any two sections must not require the user to manually adjust zoom.

## Success Criteria

- Switching between Discover, My Bets, Leaderboard, Portfolio, and Profile on a 375px-wide device shows each page at the same zoom level with no nav bar size change.
- No page requires a manual pinch-to-zoom-out to see its full layout.

## Scope Boundaries

- Not changing the layout or visual design of any page beyond what is necessary to contain width.
- Not adding `user-scalable=no` to the viewport (accessibility concern — users should still be able to zoom intentionally).
- Desktop layout is unaffected.

## Key Decisions

- **Don't suppress user zoom**: Fixing content width is preferred over `maximum-scale=1` because accessibility guidelines discourage blocking pinch-zoom.
- **Prefer overflow-x-auto over column hiding**: Keep all data visible via horizontal scroll on mobile rather than removing columns, unless a table has 6+ columns where scrolling is impractical.

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Needs research] Does hiding lower-priority columns (Positions, Win Rate, Streak) on mobile provide a better UX than horizontal scroll for the leaderboard, given it has 7 columns?
- [Affects R3][Technical] Confirm whether the Portfolio page has the same `overflow-x-auto` wrapping as History, or if it's missing.

## Next Steps

→ `/ce:plan` for structured implementation planning
