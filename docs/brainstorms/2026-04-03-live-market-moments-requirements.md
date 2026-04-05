---
date: 2026-04-03
topic: live-market-moments
---

# Live Market Moments — Halt Countdown, Resolution Animation, Share Card

## Problem Frame

Three of the most emotionally charged moments in the market lifecycle are currently wasted:

1. **The halt window** (5 minutes before resolution): trading locks and the UI shows "Trading is not available for this market" — dead UX with no signal about what's happening or when it ends.
2. **Market resolution**: a silent state change. The page shows a static "Resolved: YES/NO" label with no reveal, no celebration, no acknowledgment of the user's outcome.
3. **After placing a trade**: the TradePanel clears silently. No confirmation of what was purchased, no emotional anchor, no shareable moment.

These three moments are the highest-dopamine opportunities in the app. Converting them into distinct, felt experiences creates appointment behavior, reduces churn at resolution, and generates organic sharing.

## Requirements

### A. Halt Window Experience

- **R1.** When a market's status is `halted`, the trade panel area on `/markets/[id]` is replaced with a "FINAL CALL" countdown block showing:
  - A large, prominent countdown timer counting down to `resolvesAt`
  - The locked YES/NO odds displayed at the moment trading halted
  - A live total-coins-wagered counter (total volume from all trades on this market, updating via the existing SWR poll)
  - A label indicating trading is locked with the reason ("Resolving soon")
- **R2.** When SWR detects the market status changed to `halted` while the user is on the detail page, an in-app toast appears: "Trading locked — resolves in X:XX"
- **R3.** On the home feed (`/`), markets with status `halted` or `resolving` are separated into a "Resolving Soon" rail displayed above the main market grid. Each item in the rail shows the market title, a live countdown timer, and the current YES/NO split. The rail is hidden when no markets qualify.
- **R4.** On `MarketCard`, markets with status `halted` or `resolving` display a pulsing amber "RESOLVING SOON" badge in place of the normal status badge, and the CountdownTimer is styled with amber/urgent coloring.

### B. Resolution Animation

- **R5.** When SWR detects the market status changed to `resolved`, the right column on `/markets/[id]` plays a reveal animation before showing the outcome:
  - 0.5s: the current odds bars animate toward 0%/100% in the winning direction
  - Then: the outcome is displayed in large, bold type with color — green "YES" or red "NO"
  - If the user had a position on the winning side: a confetti or particle burst fires briefly
  - If the user had a position on the losing side: a muted fade-to-grey treatment
  - If the user had no position: a neutral reveal with no special treatment
- **R6.** The user's position outcome (won/lost) and payout amount are surfaced prominently on the resolved state panel — not buried in a table. Format: "You won +{X} coins" or "You lost {X} coins".

### C. Share Card

- **R7.** Immediately after a successful trade (BUY or SELL), a share card appears over the trade panel as a brief overlay (auto-dismisses after 4 seconds or on tap). The card shows:
  - The side taken (YES or NO) with its color
  - The amount wagered in coins
  - The current implied probability at time of trade
  - Potential payout if the market resolves in their favor
  - A "Share" button (browser native share API, falls back to copy-link)
- **R8.** After market resolution, if the user has a position, a share card appears (does not auto-dismiss). The card shows:
  - Won / Lost status
  - Market title (truncated)
  - Their original call (YES/NO) and entry odds
  - Actual payout (win) or amount lost
  - A "Share" + "Copy link" button pair
  - A dismiss button
- **R9.** The "Share" action uses `navigator.share()` where available (mobile), falling back to copying the market URL to clipboard with a "Link copied!" confirmation. No image generation — the share payload is the market URL with a text summary.

## Success Criteria

- A user watching a market resolve experiences a distinct felt moment — not a silent state change.
- A user with a winning position sees their payout immediately on resolution without navigating to `/portfolio`.
- Halted markets are surfaced prominently enough that a returning user notices them without opening each market.
- The share card appears after every trade without disrupting the next trade (auto-dismiss, or easy to close).

## Scope Boundaries

- **Not in scope:** Browser push notifications — halt and resolution signals are in-app only (toast + SWR-driven UI change).
- **Not in scope:** Generated OG image for the share card — the share payload is a URL + text summary via the native share API.
- **Not in scope:** Confetti or animation on the home feed MarketCard at resolution — animation is detail-page only.
- **Not in scope:** Emoji reactions or comments during the halt window (suggested in ideation, deferred).
- **Not in scope:** Notifying users who are *not* on the page — only in-session, on-page experiences.

## Key Decisions

- **Share card after every trade (not resolution only):** The moment a bet is placed is also emotionally charged. Showing the implied payout and a share option immediately anchors the user's conviction and creates a shareable "I called it" moment before the outcome.
- **Styled HTML card, not generated image:** Avoids image generation infrastructure. The market URL shared via native share or clipboard is enough for distribution.
- **"Resolving Soon" feed rail:** Halted markets on the home feed need a signal that's impossible to miss. A dedicated rail is higher signal than just changing the status badge color.
- **In-app toast only for notifications:** Browser push requires permission friction. The user is already on the page during the halt — a toast is sufficient and immediate.
- **Resolution share card appears automatically:** When SWR detects resolution and the user has a position, the overlay fires without requiring a tap. The moment should be felt, not searched for.

## Dependencies / Assumptions

- Market status transitions (`active → halted → resolving → resolved`) are handled server-side by existing cron jobs. This feature only consumes status; it does not change how or when transitions happen.
- SWR polling on the market detail page (currently 60s) may need a shorter interval during halt to make the transition feel live. Consider reducing to 10–15s when status is `halted` or `resolving`.
- The "total coins wagered" counter for the halt window can be computed from the existing `trades` table (sum of `cost` for this market) — no new DB columns needed.
- To show the user's position outcome on resolution (R6), the market detail page needs to know the user's current position. This data is not currently fetched on `/markets/[id]` — it would need a server action or an addition to the SWR market data.
- The `CountdownTimer` component already exists and is used on `MarketCard` and `MarketLiveData` — it can be restyled for the urgent halt state.

## Outstanding Questions

### Resolve Before Planning

_None — all blocking questions resolved._

### Deferred to Planning

- [Affects R2][Technical] How should the in-app toast be implemented? No toast library is currently in the project — plan should either use a lightweight one or build a simple fixed-position component.
- [Affects R3][Technical] The home feed (`/app/page.tsx`) is a server component. The "Resolving Soon" rail needs fresh status data. Options: (a) server-renders it on page load (stale within the session), (b) client component with SWR polling the market list, (c) filter in the server component and rely on revalidation. Assess in planning.
- [Affects R5][Technical] The confetti/particle animation for winners — use a lightweight library (e.g. `canvas-confetti`) or a pure CSS animation? Evaluate bundle cost during planning.
- [Affects R6][Technical] Fetching the user's position for the resolution panel requires either adding it to the `/api/markets/:id` SWR response or a separate fetch. Determine approach in planning.
- [Affects R1][Technical] The SWR poll interval on `MarketLiveData` is currently 60s. Should it shorten dynamically when status is `halted`? If yes, implement adaptive polling in `MarketLiveData` based on current status.

## Next Steps

→ `/ce:plan` for structured implementation planning
