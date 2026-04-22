---
title: "feat: Live Market Moments — Halt Countdown, Resolution Animation, Share Card"
type: feat
status: completed
date: 2026-04-03
origin: docs/brainstorms/2026-04-03-live-market-moments-requirements.md
---

# feat: Live Market Moments — Halt Countdown, Resolution Animation, Share Card

## Overview

Three of the highest-dopamine moments in the market lifecycle — the halt window, market resolution, and the instant after placing a trade — are currently silent or dead UX. This plan implements three coordinated features that turn each moment into a distinct, felt experience: a FINAL CALL countdown block when trading locks, an animated resolution reveal with position-aware outcome display, and a post-trade share card overlay. No new backend infrastructure is needed — all three features are purely client-side reactions to existing SWR-polled state.

(see origin: docs/brainstorms/2026-04-03-live-market-moments-requirements.md)

## Problem Statement / Motivation

- **Halt window (R1–R4):** When status becomes `halted`, `MarketLiveData` shows the generic "Trading is not available for this market" fallback. There is no signal that resolution is imminent, no countdown, and no locked-odds display. On the home feed, halted markets are visually indistinguishable from active ones except for a small status badge.
- **Resolution (R5–R6):** Status flipping to `resolved` is a silent re-render. The outcome label appears without ceremony. Users who had a position must navigate to `/portfolio` to see their payout — it is not surfaced on the market page.
- **Post-trade (R7–R9):** After `buyShares` succeeds, `TradePanel` clears silently. No confirmation anchor, no shareable moment, no implied-payout reminder.

(see origin: docs/brainstorms/2026-04-03-live-market-moments-requirements.md — Problem Frame)

## Proposed Solution

### A. Halt Window Experience (R1–R4)

1. **`HaltCountdownBlock` component** — renders in the right-column slot of `MarketLiveData` when `market.status === "halted" || "resolving"`. Shows: large countdown to `resolvesAt`, locked YES/NO odds at halt time (use current `priceYes`/`priceNo` from SWR data — they are frozen once halted), a live total-volume counter (summed from `market.priceHistory.volumeTotal` last entry, updated on each SWR revalidation), and an amber "Resolving soon — trading locked" label.

2. **Status-change toast (R2)** — `MarketLiveData` holds a ref to the previous status. When SWR delivers a new poll where `status` changed from `active` → `halted`, fire an in-app toast: "Trading locked — resolves in X:XX". Build a minimal `Toast` component (fixed-position, auto-dismisses in 5 s, no library needed) and a `useToast` hook.

3. **"Resolving Soon" feed rail (R3)** — Split `HomePage` server component: extract halted/resolving markets into a separate section rendered above the main grid. No client SWR needed — the home page re-fetches on navigation; server render is fresh enough. The rail shows `ResolvingRailCard` (title, live countdown via `CountdownTimer`, YES/NO split).

4. **`MarketCard` amber badge (R4)** — Add a pulsing amber "RESOLVING SOON" badge variant to `MarketStatusBadge`. When `status === "halted" || "resolving"`, replace the standard badge. Style `CountdownTimer` with amber/urgent coloring for these statuses via a new `variant` prop.

5. **Adaptive SWR polling (R1 dependency)** — In `MarketLiveData`, derive `refreshInterval` from current status: `halted` or `resolving` → 10 000 ms; otherwise 60 000 ms. Pass as computed value to `useSWR`.

### B. Resolution Animation (R5–R6)

1. **`ResolutionReveal` component** — Renders in the right-column slot when `market.status === "resolved"`. Animates via CSS transitions in two phases:
   - Phase 1 (500 ms): the YES/NO odds bars animate toward 0%/100% in the winning direction using a CSS `transition: width 500ms ease-in-out`.
   - Phase 2 (after 500 ms delay): large outcome label fades in — green "YES ✓" or red "NO ✗".
   - Triggered on mount (i.e., when SWR delivers `resolved` status). Use `useEffect` + `useState` for animation phase state.

2. **Position-aware outcome (R5, R6)** — To show "You won +X coins" or "You lost X coins", the user's position must be fetched. Add a server action `getUserPosition(marketId)` that queries the `positions` table for the authenticated user and returns `{ outcome, shares, avgCostBasis }`. Call it from `MarketLiveData` via `useEffect` when `market.status === "resolved"` and a session exists. Payout = `shares × 1` (LMSR: winning shares pay 1 coin each). Display prominently in `ResolutionReveal`.

3. **Confetti for winners (R5)** — Use `canvas-confetti` (lightweight, ~14 kB gzipped, no runtime dependency). Fire a brief burst only when the user's position `outcome === market.outcome`. No confetti on the home feed or `MarketCard`.

4. **Resolution share card fires automatically (R8)** — When `ResolutionReveal` mounts and the user has a position, trigger the `ResolutionShareCard` overlay (see section C) after the animation completes (~1 s delay).

### C. Share Card (R7–R9)

1. **`PostTradeShareCard` component (R7)** — An absolute-positioned overlay on the `TradePanel` container. Triggered by a new `onTradeSuccess` callback signature that passes the trade result `{ outcome, cost, shares, impliedProbability, potentialPayout }`. Auto-dismisses after 4 000 ms or on tap/click. Shows: side taken (YES/NO with color), amount wagered, implied probability at trade time (= `priceAfter`), potential payout (`shares` coins), and a Share button.

2. **`ResolutionShareCard` component (R8)** — A modal-style overlay (does not auto-dismiss). Shows: Won/Lost status, market title (truncated to 60 chars), original call (YES/NO) and entry odds (`avgCostBasis`), actual payout or amount lost, and a "Share" + "Copy link" button pair plus a dismiss button.

3. **Share action (R9)** — `navigator.share({ url, text })` where available. Falls back to `navigator.clipboard.writeText(url)` with a transient "Link copied!" label. No image generation. URL is `window.location.href`.

4. **`TradePanel` changes** — `onTradeSuccess` callback is extended to receive trade result data so `MarketLiveData` can pass it through to the share card. The share card renders as a sibling overlay inside the right-column sticky container.

## Technical Considerations

### Adaptive SWR Polling

`MarketLiveData` currently hard-codes `refreshInterval: 60_000`. Change to:

```typescript
// src/components/MarketLiveData.tsx
const isUrgentStatus = market.status === "halted" || market.status === "resolving";
const refreshInterval = isUrgentStatus ? 10_000 : 60_000;
```

Because `useSWR` accepts a dynamic `refreshInterval`, the key does not change — the hook simply re-evaluates the interval on each render after data arrives.

### Toast — No Library Required

A simple fixed-position `Toast` component and a `useToast` hook with `useState` are sufficient:

```typescript
// src/components/Toast.tsx  (new file)
// src/hooks/useToast.ts     (new file)
```

The hook returns `{ show, message, trigger }`. `MarketLiveData` holds a `prevStatusRef` and calls `trigger("Trading locked — resolves in X:XX")` on status transition.

### User Position Fetch (R6)

A new server action `getUserPosition(marketId)` in `src/lib/actions/trade.ts`:
- Queries `positions` table filtered by `userId` (from session) + `marketId`.
- Returns `{ outcome: number, shares: number, avgCostBasis: number } | null`.
- Called client-side from `MarketLiveData` via `useEffect` when status is `resolved` and session exists.
- No new API route needed — server actions are the project's established pattern for authenticated data fetching.

`MarketData` type does not need to change — position data is fetched separately and kept in local state.

### Home Feed — Server-Render the Rail (R3)

The home page at `src/app/page.tsx` is a server component that already fetches `active`, `halted`, and `resolving` markets in a single query. The "Resolving Soon" rail requires only filtering that result set — no new DB query, no client SWR. The data is fresh on each page load/navigation.

```typescript
// src/app/page.tsx
const resolvingSoon = activeMarkets.filter(
  m => m.status === "halted" || m.status === "resolving"
);
const mainMarkets = activeMarkets.filter(
  m => m.status === "active"
);
```

A `ResolvingRailCard` component renders each item in the rail with title, `CountdownTimer`, and YES/NO split.

### Canvas-Confetti Bundle Impact

`canvas-confetti` is ~14 kB gzipped. It should be dynamically imported so it only loads when `ResolutionReveal` mounts with a winning position:

```typescript
// src/components/ResolutionReveal.tsx
const confetti = (await import("canvas-confetti")).default;
```

This keeps it out of the initial bundle.

### `TradePanel` Callback Extension

`onTradeSuccess` currently has signature `() => void`. Extend to:

```typescript
onTradeSuccess?: (result: { outcome: number; cost: number; shares: number; priceAfter: number }) => void;
```

`MarketLiveData` already passes this callback. It will be updated to also call `mutate()` and set share card state.

## System-Wide Impact

### Interaction Graph

- `buyShares` server action → returns `{ success, shares, cost }` → `TradePanel` calls `onTradeSuccess(result)` → `MarketLiveData` calls `mutate()` (SWR revalidation) + sets `postTradeResult` state → `PostTradeShareCard` renders.
- SWR poll fires every 10 s when halted → `MarketLiveData` compares `prevStatus` ref → if transition to `halted`, toast fires; if transition to `resolved`, `ResolutionReveal` mounts and `getUserPosition` is called.
- `ResolutionReveal` mounts → animation phase state → after 1 s, if user has winning position, `ResolutionShareCard` opens + confetti fires.

### Error Propagation

- `getUserPosition` failure: non-blocking — resolution reveal still shows outcome; position panel shows nothing rather than crashing. Handle with try/catch, set position to `null`.
- `navigator.share` rejection (user dismisses share sheet): catch `AbortError`, no-op.
- `canvas-confetti` dynamic import failure: catch and ignore — confetti is purely cosmetic.
- SWR fetch failure during halt: SWR retries automatically. Countdown timer continues from last known `resolvesAt` — unaffected by fetch failures.

### State Lifecycle Risks

- `postTradeResult` state in `MarketLiveData`: set on trade success, cleared when share card is dismissed or auto-dismissed. If the user trades again before dismissal, the existing card is replaced with the new result.
- `prevStatusRef` for toast: a `useRef`, updated after each render. No risk of stale closure — ref is always current.
- `userPosition` state: fetched once when status becomes `resolved`. Subsequent SWR polls do not re-fetch it (guard: fetch only if `userPosition === undefined`, not on every render).

### API Surface Parity

- `TradePanel` interface change (`onTradeSuccess` signature) — `MarketLiveData` is the only consumer; no other callers exist.
- `CountdownTimer` gains an optional `variant` prop (`"default" | "urgent"`) — `MarketCard` and `MarketLiveData` both use `CountdownTimer`; both are updated to pass `variant="urgent"` when status is halted/resolving.
- `MarketStatusBadge` gains a `pulsing` boolean prop — only `MarketCard` uses it today.

### Integration Test Scenarios

1. **Halt transition while watching:** SWR delivers `status: "halted"` after 10 s poll → `HaltCountdownBlock` replaces TradePanel → toast fires once → no second toast on subsequent polls with same status.
2. **Resolution with winning position:** SWR delivers `status: "resolved"` with `outcome: 0` (YES) → animation plays → `getUserPosition` returns a YES position → confetti fires → `ResolutionShareCard` opens → user taps Share → `navigator.share` called with market URL.
3. **Resolution with no position:** SWR delivers resolved → neutral reveal, no confetti, no share card auto-open (share card deferred; user can manually share via a link if present).
4. **Post-trade share card:** User places a trade → `PostTradeShareCard` appears → auto-dismisses after 4 s → user can place another trade immediately; no UI lockout.
5. **Home feed rail:** Admin halts a market → on next home page load, the market appears in "Resolving Soon" rail above main grid with live countdown.

## Acceptance Criteria

### Functional

- [ ] **R1** — When `market.status` is `halted` or `resolving`, the right column on `/markets/[id]` shows `HaltCountdownBlock` instead of `TradePanel` or the generic "Trading is not available" message. Block includes: countdown to `resolvesAt`, locked YES/NO odds, total volume, "Resolving soon" label.
- [ ] **R2** — When SWR detects a status change from `active` → `halted` while the user is on the market detail page, a toast appears with "Trading locked — resolves in X:XX". Toast fires only once per transition.
- [ ] **R3** — Home feed shows a "Resolving Soon" rail above the main market grid when any markets have status `halted` or `resolving`. Rail is hidden when none qualify.
- [ ] **R4** — `MarketCard` displays a pulsing amber "RESOLVING SOON" badge and amber-styled `CountdownTimer` for halted/resolving markets.
- [ ] **R5** — When SWR detects `status: "resolved"`, the right column plays a reveal animation: odds bars animate toward 0/100%, then outcome label fades in. If user has a winning position, confetti fires. If losing, muted fade treatment.
- [ ] **R6** — Resolved state panel shows "You won +X coins" or "You lost X coins" prominently, without requiring navigation to `/portfolio`. Only visible when user is authenticated and has a position.
- [ ] **R7** — After a successful trade, a share card overlay appears on the trade panel area showing: side, amount, implied probability, potential payout, and Share button. Auto-dismisses in 4 s or on tap.
- [ ] **R8** — After market resolution with a user position, a share card appears (does not auto-dismiss) showing: Won/Lost, market title, original call and entry odds, payout/loss, Share + Copy link buttons, and dismiss button.
- [ ] **R9** — Share action uses `navigator.share()` where available; falls back to clipboard copy with "Link copied!" confirmation. No image generation.

### Non-Functional

- [ ] Adaptive SWR polling: 10 s when `halted`/`resolving`, 60 s otherwise.
- [ ] `canvas-confetti` is dynamically imported — not included in initial JS bundle.
- [ ] Toast component has no third-party dependency.
- [ ] No new DB columns or migrations required.
- [ ] All new components are `"use client"` where appropriate; server components (`app/page.tsx`) remain server components.
- [ ] Share card does not block placing a subsequent trade (overlay clears on dismiss or auto-dismiss).

### Quality Gates

- [ ] TypeScript strict mode: no `any`, no type assertions without comment.
- [ ] No lint errors (`npm run lint`).
- [ ] Existing tests pass (`npm test`).
- [ ] Manual QA: test all three moments in sequence on a market that goes through `active → halted → resolved`.

## Dependencies & Prerequisites

| Dependency | Status | Notes |
|---|---|---|
| `canvas-confetti` | Must install | `npm install canvas-confetti && npm install -D @types/canvas-confetti` |
| Market status transitions | Existing (cron) | No changes to server-side resolution logic |
| `positions` table | Existing | `getUserPosition` server action reads it |
| `trades.cost` / `priceAfter` | Existing, returned by `buyShares` | Need to expose in `onTradeSuccess` callback |
| SWR + `useSWR` | Existing (`swr ^2.4.1`) | Adaptive interval is a supported pattern |
| `CountdownTimer` | Existing | Needs `variant` prop added |
| `MarketStatusBadge` | Existing | Needs pulsing amber variant |

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SWR misses the `active → halted` transition (poll arrives after transition, user was offline) | Low | Low | Toast only needs to fire; if missed, the halt block itself is the primary signal |
| `getUserPosition` returns stale data (race between resolution and position fetch) | Low | Low | Position data only affects the outcome panel, not the animation; cosmetic degradation at worst |
| `navigator.share` unavailable on desktop | High | Low | Fallback to clipboard copy is implemented |
| `canvas-confetti` bundle unexpectedly large | Very low | Low | Dynamic import; 14 kB gzipped is acceptable |
| Home feed rail data stale during session | Medium | Low | Server component re-fetches on each navigation; acceptable per requirements (see origin: scope) |

## Implementation Phases

### Phase 1 — Foundation (Toast + Adaptive Polling + MarketCard Badge)

Files to touch:
- `src/components/Toast.tsx` — new component
- `src/hooks/useToast.ts` — new hook
- `src/components/CountdownTimer.tsx` — add `variant` prop
- `src/components/MarketStatusBadge.tsx` — add pulsing amber variant
- `src/components/MarketCard.tsx` — use new badge + timer variants for halted/resolving
- `src/components/MarketLiveData.tsx` — adaptive SWR interval, toast on status transition

Deliverable: adaptive polling live, amber badges on `MarketCard`, toast fires on halt transition.

### Phase 2 — Halt Window Block + Home Feed Rail

Files to touch:
- `src/components/HaltCountdownBlock.tsx` — new component
- `src/components/ResolvingRailCard.tsx` — new component
- `src/components/MarketLiveData.tsx` — render `HaltCountdownBlock` when halted/resolving
- `src/app/page.tsx` — split active markets into "Resolving Soon" rail + main grid

Deliverable: FINAL CALL block on market detail, "Resolving Soon" rail on home feed.

### Phase 3 — Resolution Animation + Position Panel

Files to touch:
- `src/components/ResolutionReveal.tsx` — new component (animation + outcome label)
- `src/lib/actions/trade.ts` — add `getUserPosition(marketId)` server action
- `src/components/MarketLiveData.tsx` — render `ResolutionReveal` when resolved, fetch position
- Install `canvas-confetti`

Deliverable: full resolution reveal animation, "You won/lost X coins" panel.

### Phase 4 — Share Cards

Files to touch:
- `src/components/PostTradeShareCard.tsx` — new component
- `src/components/ResolutionShareCard.tsx` — new component
- `src/components/TradePanel.tsx` — extend `onTradeSuccess` callback signature
- `src/components/MarketLiveData.tsx` — manage share card state, auto-open on resolution

Deliverable: post-trade share card and resolution share card, both with native share/clipboard fallback.

## Alternative Approaches Considered

| Decision | Chosen Approach | Alternative Rejected | Reason |
|---|---|---|---|
| Home feed rail data freshness | Server-render on page load | Client SWR polling the market list | SWR would require converting `page.tsx` to a client component or extracting a child client component; server render is fresh enough per session and simpler (see origin) |
| Confetti | `canvas-confetti` dynamic import | Pure CSS keyframe animation | CSS confetti is significantly more complex to implement convincingly; `canvas-confetti` is battle-tested and tiny when deferred (see origin) |
| Toast implementation | Bespoke `Toast` + `useToast` | `react-hot-toast` or `sonner` | No toast library currently exists in the project; a 30-line bespoke component avoids a new dependency for a single use case (see origin) |
| Share payload | URL + text summary via native share API | OG image generation | Image generation requires server-side rendering infrastructure (Puppeteer or Satori); out of scope (see origin) |
| User position data for resolution panel | New `getUserPosition` server action | Add position to `/api/markets/[id]` SWR response | Adding position to the market API would expose all users' positions — a privacy concern. Server action is authenticated and returns only the session user's data (see origin — deferred to planning) |

## Documentation Plan

No external documentation changes required. The new components are self-contained. Add inline JSDoc comments to:
- `HaltCountdownBlock` — document `volumeTotal` computation source
- `getUserPosition` server action — document that it returns `null` for unauthenticated users or users with no position
- `useToast` — document the single-fire transition guard

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-04-03-live-market-moments-requirements.md](../brainstorms/2026-04-03-live-market-moments-requirements.md)
  Key decisions carried forward:
  1. Share card appears after every trade (not resolution only) — the placement moment is also emotionally charged
  2. HTML share card, not generated image — avoids image generation infrastructure
  3. "Resolving Soon" feed rail over a changed badge — impossible-to-miss signal

### Internal References

- `src/components/MarketLiveData.tsx` — SWR polling, right-column layout, status branching
- `src/components/TradePanel.tsx` — `onTradeSuccess` callback, `buyShares` integration
- `src/components/CountdownTimer.tsx` — existing timer to be restyled for urgent state
- `src/components/MarketStatusBadge.tsx` — existing badge to receive pulsing amber variant
- `src/components/MarketCard.tsx` — receives updated badge + timer
- `src/app/page.tsx` — server component home feed, split into rail + grid
- `src/app/api/markets/[id]/route.ts` — SWR endpoint; no changes needed
- `src/lib/actions/trade.ts` — `buyShares` return shape; add `getUserPosition`
- `src/db/schema.ts` — `positions` table shape (outcome, shares, avgCostBasis)
- `src/types/market.ts` — `MarketData` interface; no changes needed

### External References

- `canvas-confetti` npm: https://www.npmjs.com/package/canvas-confetti (~14 kB gzipped, zero dependencies)
- `navigator.share()` MDN: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
- SWR dynamic options: https://swr.vercel.app/docs/options#options (`refreshInterval` accepts a function or number)

### ERD Note

No new database tables or columns are introduced. All data is derived from existing `markets`, `positions`, `trades`, and `priceSnapshots` tables.
