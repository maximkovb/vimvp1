---
date: 2026-04-04
topic: mobile-first-ui-overhaul
---

# Mobile-First UI Overhaul (Doomscroll Feed)

## Problem Frame

The current Virality UI uses a traditional desktop-first design: horizontal top navbar, static card grid, no mobile-specific interaction patterns. Users on mobile get a degraded experience — the grid is cramped, there's no immersive feed, and betting requires navigating to a separate page. The goal is a TikTok-style experience where scrolling through markets feels native on mobile, while desktop gets an equally polished layout with a left sidebar and the same feed interaction.

## Requirements

- R1. **Doomscroll feed (home/Discover)** — The main market listing replaces the current card grid with a vertical full-screen snap-scroll feed. Each card fills the viewport. Users scroll through cards one at a time, TikTok-style.
- R2. **Feed card layout** — Each feed card displays: video thumbnail as full-bleed background with gradient overlays, creator username and caption at the bottom, YES/NO bet buttons prominently at the bottom, a circular progress ring (current views vs. milestone target) in the top-right corner, and a "Trending" badge when applicable.
- R3. **Grid overview at feed end** — After scrolling past the last market card, the feed transitions to a grid view showing all markets the user just scrolled through. This acts as a "browse all" summary. Applies on both mobile and desktop.
- R4. **Bet sheet** — Tapping anywhere on a feed card opens a bottom sheet that slides up over the feed. Tapping the YES or NO button pre-selects that side; tapping anywhere else opens the sheet with no pre-selection. The sheet contains the full trade panel: price chart, amount input, buy/sell controls. The feed remains dimmed but visible behind it. The sheet is draggable to dismiss.
- R5. **Bottom navigation (mobile)** — On mobile (< `md` breakpoint), a fixed bottom nav bar replaces the current top navbar as the primary navigation. Five tabs: Discover (🔥), My Bets (💰), Leaderboard (🏆), Portfolio (💼), Profile (👤). The top navbar is hidden on mobile.
- R6. **Left sidebar navigation (desktop)** — On desktop (≥ `md` breakpoint), the current top horizontal navbar is replaced by a fixed left sidebar. It contains the Virality logo, the same five nav tabs as R6, and the user balance chip + sign-in/sign-out controls. The top navbar is removed on desktop as well.
- R7. **Tab mapping** — The five nav tabs map to existing routes: Discover → `/`, My Bets → `/history`, Leaderboard → `/leaderboard`, Portfolio → `/portfolio`, Profile → `/profile` (new or existing page).
- R8. **All existing functionality preserved** — Market detail page (`/markets/[id]`), admin flows, auth, trade history, leaderboard, and portfolio pages remain functionally unchanged. Only their chrome (navbar → sidebar/bottom nav) changes.
- R9. **Desktop feed column** — On desktop, the doomscroll feed renders in a centered column (approx. 390px wide, matching a phone form factor). The left sidebar sits to its left; remaining space is empty.

## Success Criteria

- A user on mobile can discover markets, bet YES/NO, and navigate to all major sections without ever seeing the old top navbar.
- A user on desktop experiences the same feed interaction as mobile, with a left sidebar for navigation instead of a bottom bar.
- After scrolling to the last market, both mobile and desktop users see the grid overview without a page reload.
- Tapping a feed card opens the bet sheet without leaving the feed.
- All existing pages (market detail, portfolio, leaderboard, history, admin) remain accessible and functional.

## Scope Boundaries

- Colors, fonts, and design tokens are **not** changing — the existing theme (`bg-card`, `text-accent`, etc.) is preserved. The mockup's neon aesthetic (magenta, cyan, lime) is for reference on layout/flow only.
- The market detail page (`/markets/[id]`) is **not** being redesigned — it stays as-is; the bet sheet in R4 reuses the existing `TradePanel` component.
- No new backend routes or data schema changes are required.
- A dedicated Profile page (`/profile`) is in scope only if one doesn't already exist; if it does, it just needs to be reachable from the new nav.
- Admin UI is out of scope for restyling.
- The "Resolving Soon" horizontal rail placement is deferred to planning (either pinned at the top of the feed or incorporated into the grid overview).

## Key Decisions

- **Slide-up bet sheet over page navigation**: Keeps the user in the feed context; reduces page transitions on mobile. The existing `/markets/[id]` detail page remains for deep-linking and desktop direct access.
- **Hybrid feed → grid**: Preserves the doomscroll discovery experience while giving users a way to quickly review and compare all available markets without re-scrolling.
- **Left sidebar replaces top navbar on desktop**: Matches TikTok web's layout and gives the feed column more vertical space.

## Dependencies / Assumptions

- The existing `TradePanel` component can be rendered inside a bottom sheet (may need minor layout adjustments — see Deferred to Planning).
- A `/profile` route exists or can be created as a thin wrapper around existing profile/user-menu content.

## Outstanding Questions

### Resolve Before Planning

_(none — all blocking product decisions resolved)_

### Deferred to Planning

- [Affects R3][Technical] How does the grid overview handle pagination if there are more markets than the initial fetch limit (currently 50)?
- [Affects R4][Needs research] Does `TradePanel` need props/layout adjustments to render inside the constrained height of the bottom sheet?
- [Affects R5/R6][Technical] Should the bottom nav and sidebar be client components (for active-tab highlighting) or can active state be derived from the URL server-side?
- [Affects R7][Technical] Does a `/profile` page already exist? If not, what minimum content should it show (username, balance, settings link)?
- [Affects R1][Needs research] Which approach works best in Next.js App Router for the full-screen snap feed (CSS scroll-snap vs. a JS library)?

## Next Steps

→ `/ce:plan` for structured implementation planning
