---
title: "feat: Persistent coin balance HUD in navbar"
type: feat
status: active
date: 2026-04-03
origin: docs/brainstorms/2026-04-03-persistent-coin-balance-hud-requirements.md
---

# feat: Persistent Coin Balance HUD

## Overview

Users currently cannot see their coin balance without navigating away to `/portfolio`. This breaks the core betting loop: every trade decision is constrained by available balance, yet the balance is the most hidden piece of information in the app. The fix is to make the balance a persistent, always-visible element in the navbar — a game HUD pattern — along with a flyout that surfaces the last 5 transactions, login streak, and the ability to claim a daily reward without leaving the current page.

(see origin: docs/brainstorms/2026-04-03-persistent-coin-balance-hud-requirements.md)

## Problem Statement

- Users must navigate to `/portfolio` to check their balance before every trade.
- Daily reward claims require a full page visit to `/portfolio`, breaking streaks for users who never visit that page.
- The navbar has unused space between nav links and the user avatar on both desktop and mobile.

## Proposed Solution

Add a `BalanceChip` client component to the Navbar. The chip displays the user's cash balance (rounded integer + coin icon) and is only rendered for authenticated users. Clicking the chip opens a `BalanceFlyout` overlay that shows recent transactions, streak state, and a claim button — all without navigation. After a trade or reward claim in the current session, the chip animates to the new value.

**Key decisions carried forward from origin document:**
- Top navbar placement (not bottom bar) — keeps scope tight, ships fast (see origin: Key Decisions)
- Mini flyout (not navigate to `/portfolio`) — preserves scroll position and context (see origin: Key Decisions)
- Claim from flyout — users who never visit `/portfolio` can still maintain their streak (see origin: Key Decisions)
- Session-scoped updates only — no continuous polling, only post-trade or post-claim mutation (see origin: Key Decisions)

## Technical Approach

### Architecture

The `Navbar` is a React Server Component rendered once in `src/app/layout.tsx`. It fetches `session` server-side. The new flow adds a server-side balance fetch to the Navbar and passes the initial balance as a prop to a new `BalanceChip` client component. After trades or reward claims, the client mutates a shared SWR key to refresh the balance without a full page re-render.

**Resolved planning questions (from origin "Deferred to Planning"):**

1. **Post-trade balance sync** — Use a dedicated SWR key (`/api/balance`) rather than `router.refresh()`. Rationale: `router.refresh()` re-renders the entire server component tree (including heavy market data) on the market detail page. SWR on a cheap `/api/balance` endpoint is surgical and consistent with the already-present `swr@^2.4.1` dependency. `TradePanel` calls `mutate('/api/balance')` after a successful `buyShares` or `sellShares` result.

2. **Initial value delivery** — Pass the initial balance as a prop from the server component `Navbar` to the client component `BalanceChip`. This avoids a client-side loading flash on first render. SWR is initialized with the server-provided value as `fallbackData`.

3. **Flyout transaction data** — Add a new lightweight server action `getRecentActivity()` in `src/lib/actions/economy.ts` that returns the last 5 `coinTransactions` rows (joined to markets for title when `type === 'trade'`) plus the user's current `loginStreak` and `lastLoginReward`. The flyout fetches this on open (lazy) using `useTransition` or a local `useState` + server action call. This avoids an extra HTTP route and reuses the Drizzle pattern already established in the codebase.

### Data Flow

```
Navbar (RSC)
  └─ fetches: users.balance, users.loginStreak, users.lastLoginReward   [server, initial render]
  └─ renders: <BalanceChip initialBalance={balance} userId={userId} />

BalanceChip (client)
  └─ SWR key: '/api/balance'  fallbackData: initialBalance
  └─ on open: calls getRecentActivity() server action → flyout data
  └─ on trade success (via onTradeSuccess prop): mutate('/api/balance')
  └─ on claim success: mutate('/api/balance'), updates flyout state

TradePanel (client)
  └─ onTradeSuccess callback → already exists as optional prop
  └─ caller (market page) wires: onTradeSuccess={() => mutate('/api/balance')}

SellButton (client)
  └─ same pattern: onSellSuccess callback → mutate('/api/balance')
```

### New Files

| File | Purpose |
|---|---|
| `src/components/BalanceChip.tsx` | Client component: coin chip + flyout, SWR-driven balance, animation |
| `src/app/api/balance/route.ts` | `GET /api/balance` — returns `{ balance, loginStreak, lastLoginReward }` for the authed user |

### Modified Files

| File | Change |
|---|---|
| `src/components/Navbar.tsx` | Fetch initial balance server-side; render `<BalanceChip>` between nav links and `<UserMenu>` |
| `src/lib/actions/economy.ts` | Add `getRecentActivity()` server action |
| `src/components/TradePanel.tsx` | Call `mutate('/api/balance')` in `onTradeSuccess` (passed down from market page) |
| `src/components/SellButton.tsx` | Same `mutate` pattern after successful sell |
| `src/app/markets/[id]/page.tsx` | Pass `onTradeSuccess` / `onSellSuccess` callbacks to `TradePanel` / `SellButton` |

### `GET /api/balance` Route

Minimal endpoint, auth-gated:

```ts
// src/app/api/balance/route.ts
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [user] = await db.select({ balance: users.balance, loginStreak: users.loginStreak, lastLoginReward: users.lastLoginReward })
    .from(users).where(eq(users.id, session.user.id)).limit(1);
  return NextResponse.json(user ?? { error: "Not found" }, { status: user ? 200 : 404 });
}
```

### `getRecentActivity()` Server Action

```ts
// src/lib/actions/economy.ts (addition)
export async function getRecentActivity(): Promise<{
  transactions: Array<{ id: string; amount: string; type: CoinTransactionType; marketTitle: string | null; createdAt: Date }>;
  loginStreak: number;
  lastLoginReward: Date | null;
} | { error: string }>
```

Queries last 5 `coinTransactions` for the authed user, left-joins `markets` on `referenceId` for the title (only relevant for `type === 'trade'`). Returns streak and `lastLoginReward` so the flyout can render either the "Claim" or countdown state.

### BalanceChip Component

```tsx
// src/components/BalanceChip.tsx
"use client";
// Props: initialBalance: number
// Internal: useSWR('/api/balance', fetcher, { fallbackData: { balance: initialBalance } })
// State: open (flyout), activity (lazy-fetched on open), animating
// Animation: CSS transition on displayed number (count-up/count-down via requestAnimationFrame or CSS keyframes)
// Closes flyout on Escape and outside click (same backdrop pattern as UserMenu)
```

**Coin icon:** Use a simple inline SVG or Unicode coin emoji (🪙) — no new icon library dependency.

**Animation:** On balance change detection (previous vs new SWR value), trigger a CSS class `animate-balance-change` that pulses the chip border with `accent` color for 800ms, while the displayed integer counts from old to new value over ~400ms via `requestAnimationFrame`.

### Mobile Layout

The chip is inserted between the nav-links `div` and the right-side actions `div` in `Navbar`. On mobile (`sm:hidden` nav links are hidden), the chip occupies the space currently empty between the logo area and the avatar, satisfying R9 with no extra layout work. The flyout is anchored to the chip and uses `fixed` positioning with a reasonable `max-width` so it does not overflow on small screens.

## System-Wide Impact

### Interaction Graph

1. User buys shares → `buyShares()` server action succeeds → `TradePanel.onTradeSuccess()` fires → `mutate('/api/balance')` → SWR refetches `GET /api/balance` → `BalanceChip` receives new balance → animation triggers.
2. User claims reward from flyout → `claimDailyReward()` fires → on success, `mutate('/api/balance')` + local flyout state update to "claimed" state → countdown renders.
3. `claimDailyReward()` already calls `revalidatePath('/')` and `revalidatePath('/portfolio')` — these continue to work for RSC cache invalidation; they do not interfere with the SWR client cache.

### Error Propagation

- `GET /api/balance` returns 401 for unauthenticated — SWR will surface an error but `BalanceChip` is never rendered for unauthenticated users (R8), so this is an unreachable path in normal usage.
- `getRecentActivity()` failure on flyout open: show a simple "Could not load activity" message in the flyout; do not crash the chip.
- `claimDailyReward()` already-claimed error: flyout shows "Already claimed" state (same as the existing `DailyReward` component pattern).

### State Lifecycle Risks

- SWR fallbackData is the server-rendered balance. On first load, the chip shows the correct value without any flash. After a trade, the SWR refetch hits the DB for the authoritative value — no stale cache risk.
- The flyout's activity data is fetched lazily on open. If the user opens the flyout before a trade has been reflected server-side, the list may be one trade behind. This is acceptable per scope (session-scoped, not real-time across devices).

### API Surface Parity

- `GET /api/portfolio` already returns `balance` and `loginStreak`. The new `GET /api/balance` is a lighter version. These are parallel routes; no shared code path, so a change to one does not affect the other. Consider consolidating in the future, but out of scope here.
- `claimDailyReward()` is called from both `DailyReward` (on `/portfolio`) and the new flyout. The server action is stateless and idempotent (already-claimed guard), so dual callers are safe.

### Integration Test Scenarios

1. **Trade → chip animates:** Buy shares on a market page → verify `GET /api/balance` is called once → chip shows new (lower) balance with animation class applied.
2. **Claim from flyout → chip updates:** Open flyout, click "Claim" → `claimDailyReward()` succeeds → flyout transitions to "Already claimed" + countdown → `GET /api/balance` returns new (higher) balance → chip animates upward.
3. **Claim already done → flyout shows countdown:** Open flyout when `lastLoginReward` is today → "Claim" button is absent, countdown renders showing hours until next reward.
4. **Unauthenticated user:** No chip rendered — Sign In button visible — no balance API calls.
5. **Flyout outside-click dismiss:** Open flyout, click outside → flyout closes without navigation.

## Acceptance Criteria

### Functional

- [ ] **R1** Coin balance chip visible in navbar on all pages (desktop and mobile) for authenticated users
- [ ] **R2** Chip shows cash balance (rounded integer) with a coin icon
- [ ] **R3** After a successful trade (buy or sell), chip animates to new value with a brief highlight
- [ ] **R4** Clicking chip opens flyout overlay anchored to the chip; does not navigate
- [ ] **R5** Flyout shows: current balance header, last 5 transactions (delta, type label, truncated market title), login streak with flame icon, and either Claim button or countdown
- [ ] **R6** After reward claim from flyout, chip animates to new balance and flyout shows "Already claimed" with countdown
- [ ] **R7** Flyout closes on outside click (and Escape key)
- [ ] **R8** Chip only rendered for authenticated users; Sign In button unchanged for unauthenticated
- [ ] **R9** Chip appears in mobile navbar between nav links area and avatar

### Non-Functional

- [ ] No new npm dependencies introduced
- [ ] `GET /api/balance` responds in < 100ms (single indexed query on `users`)
- [ ] Flyout opens with no visible layout shift or full-page re-render

### Quality Gates

- [ ] `BalanceChip` renders correctly with no session (returns null)
- [ ] `getRecentActivity()` server action is tested with a user who has no transactions (empty array, not error)
- [ ] Animation does not run on the initial server-provided value (only on subsequent SWR updates)

## Success Criteria

(see origin: docs/brainstorms/2026-04-03-persistent-coin-balance-hud-requirements.md)

- A user placing a bet can see their remaining balance update without touching the navigation.
- A user can claim their daily reward without visiting `/portfolio`.
- The balance chip is visible on every page in the app.
- The flyout renders the last 5 transactions accurately and the streak state correctly.

## Scope Boundaries (from origin)

**Not in scope:**
- Live polling from other devices/tabs — session-scoped only
- Total portfolio value in chip — cash balance only
- Bottom tab navigation bar for mobile
- Redesigning the existing `DailyReward` component on `/portfolio`
- Streak multiplier / bonus calculation details in flyout

## Dependencies & Risks

| Item | Detail |
|---|---|
| `claimDailyReward()` reusable | Confirmed: it is a plain server action with no UI coupling (see `src/lib/actions/economy.ts`) |
| SWR already installed | `swr@^2.4.1` present in `package.json` — no new dependency needed |
| `onTradeSuccess` callback on `TradePanel` | Already exists as optional prop — needs `mutate` wired at the call site in the market page |
| `SellButton` callback | Needs same treatment as `TradePanel` — check if `onSellSuccess` prop exists or needs adding |
| Flyout z-index | `UserMenu` uses `z-50` for its dropdown — flyout must use the same or higher; verify no overlap |
| Mobile layout gap | Navbar flex layout: chip goes between `<div className="flex items-center gap-6">` and `<div className="flex items-center gap-3">` — straightforward insertion |

## Future Considerations

- The `GET /api/balance` and `GET /api/portfolio` routes could be consolidated once the portfolio page migrates to client-side rendering.
- If real-time multi-tab balance sync becomes a requirement, the SWR key approach makes it easy to add `refreshInterval` or a `BroadcastChannel`-based revalidation.
- Bottom tab navigation for mobile (explicitly deferred per origin) could absorb the balance chip into its design when implemented.

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-04-03-persistent-coin-balance-hud-requirements.md](docs/brainstorms/2026-04-03-persistent-coin-balance-hud-requirements.md)
  Key decisions carried forward: (1) top navbar placement over bottom bar, (2) mini flyout over full-page navigation, (3) session-scoped SWR updates over continuous polling

### Internal References

- Navbar server component: `src/components/Navbar.tsx`
- Root layout (single Navbar mount): `src/app/layout.tsx`
- Economy server actions (`claimDailyReward`): `src/lib/actions/economy.ts`
- Existing `DailyReward` client component (reference for claim UX): `src/components/DailyReward.tsx`
- Existing `UserMenu` (reference for flyout/dropdown pattern, z-index, outside-click dismiss): `src/components/UserMenu.tsx`
- `TradePanel` (`onTradeSuccess` prop, buy flow): `src/components/TradePanel.tsx`
- `SellButton` (sell flow): `src/components/SellButton.tsx`
- Portfolio page (transaction/streak query patterns): `src/app/portfolio/page.tsx`
- Portfolio API route (balance + trades query): `src/app/api/portfolio/route.ts`
- Schema (`users`, `coinTransactions`, `trades`): `src/db/schema.ts`

### Related Work

- Auth pattern: `src/lib/auth.ts` — same `auth()` call used in Navbar today
