---
date: 2026-04-03
topic: persistent-coin-balance-hud
---

# Persistent Coin Balance HUD

## Problem Frame

Users currently have no way to see their coin balance without navigating to `/portfolio`. This breaks the core betting loop — every time a user wants to place a bet, they first have to interrupt their flow to check how many coins they have. The balance is the primary constraint on every trade decision, yet it's the most hidden piece of information in the app.

The fix: make the balance a persistent, always-visible element in the navbar — a game HUD, not an account page detail.

## Requirements

- **R1.** A coin balance chip is displayed in the navbar on all pages (desktop and mobile), positioned to the left of the user avatar.
- **R2.** The chip shows the user's cash balance (not total portfolio value) as a rounded integer with a coin icon.
- **R3.** After a successful trade (buy or sell) in the same browser session, the balance chip animates to the new value (count-up or count-down) and the chip briefly highlights to signal the change.
- **R4.** Tapping or clicking the balance chip opens a mini flyout overlay anchored to the chip. The flyout does not navigate away from the current page.
- **R5.** The flyout shows:
  - The current balance as a header
  - The last 5 transactions (trade or reward), each showing: amount delta (+ or −), type label (Buy YES / Buy NO / Sell / Daily Reward), and market title truncated if needed
  - Current login streak with a flame icon
  - One of two states for daily reward:
    - **Unclaimed:** streak count, reward amount for today, and a "Claim" button that fires the existing `claimDailyReward` server action
    - **Already claimed:** streak count and a countdown to next reward (24h window from last claim)
  - A "View full portfolio →" link to `/portfolio`
- **R6.** After a successful daily reward claim from the flyout, the balance chip animates to the new balance and the flyout updates to show the "Already claimed" state with the next-reward countdown.
- **R7.** The flyout closes when the user clicks outside it.
- **R8.** The chip is only rendered when the user is authenticated. Unauthenticated users see no chip (the Sign In button remains as-is).
- **R9.** On mobile, the chip appears in the top navbar between the nav links area and the avatar — it replaces the layout gap currently occupied by nothing.

## Success Criteria

- A user placing a bet can see their remaining balance update without touching the navigation.
- A user can claim their daily reward without visiting `/portfolio`.
- The balance chip is visible on every page in the app.
- The flyout renders the last 5 transactions accurately and the streak state correctly.

## Scope Boundaries

- **Not in scope:** Live polling of balance from other devices or tabs — balance is refreshed only after trades or claims in the current session.
- **Not in scope:** Showing open position value or total portfolio value in the chip — cash balance only.
- **Not in scope:** Bottom tab navigation bar for mobile — deferred to a separate initiative.
- **Not in scope:** Redesigning the DailyReward component on `/portfolio` — it stays as-is; the flyout adds a parallel claim path.
- **Not in scope:** Showing the streak multiplier or bonus calculation details in the flyout — just the streak count and base reward amount.

## Key Decisions

- **Top navbar (not bottom bar):** Keeps scope tight and ships fast. Bottom tab nav is a separate, larger initiative.
- **Mini flyout (not navigate to /portfolio):** Preserves the user's current context and scroll position. Portfolio still exists for the full view.
- **Claim from flyout:** Users who never visit /portfolio should still be able to maintain their streak. Moving the claim here is the path of least friction.
- **Session-scoped updates only:** Polling adds continuous network cost with marginal benefit — the only case that matters is "I just traded, is my balance right?" This is handled by post-trade mutation.

## Dependencies / Assumptions

- `claimDailyReward` server action in `src/lib/actions/economy.ts` is reusable as-is.
- A new `GET /api/balance` route (or equivalent server action) is needed to let the client chip fetch the current balance after a trade.
- The root layout renders `<Navbar />` once globally — balance fetch happens there (server-side initial value) and the chip hydrates as a client component.
- The `TradePanel` needs a mechanism to signal the balance chip after a successful trade — either via a shared SWR key mutation or a React context event.

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Technical] Should post-trade balance sync use `router.refresh()` (re-renders server components) or a dedicated SWR key on `/api/balance`? Trade-off: `router.refresh()` is simpler but re-renders the whole page; SWR is more surgical but requires a new API route and a shared mutate signal between TradePanel and the chip.
- [Affects R3][Technical] How should the BalanceChip client component receive its initial value? Options: passed as a prop from the server component Navbar, or fetched client-side on mount. The prop approach avoids a client-side loading state.
- [Affects R5][Technical] The flyout's last-5-transactions list needs a lightweight data fetch. Reuse the existing trades query from `/portfolio/page.tsx` via a server action, or add a `/api/transactions?limit=5` route?

## Next Steps

→ `/ce:plan` for structured implementation planning
