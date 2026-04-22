---
title: "feat: Display time remaining on FeedCard"
type: feat
status: active
date: 2026-04-19
origin: docs/brainstorms/2026-04-18-progress-bar-time-remaining-requirements.md
---

# feat: Display time remaining on FeedCard

## Overview

Add a live countdown to `FeedCard` so users can gauge market urgency directly from the feed. Desktop shows the countdown below the progress bar's existing label row. Mobile shows a small persistent label in the top-right corner of the card. Both surfaces turn red when under 1 hour remains and show "Ended" when the market closes.

## Problem Frame

The progress bar encodes view progress and YES/NO odds but gives no urgency signal. Users must tap through to the market detail page to discover time remaining. (See origin: `docs/brainstorms/2026-04-18-progress-bar-time-remaining-requirements.md`)

## Requirements Trace

- R1. Desktop: time remaining visible below the progress bar's `showLabels` row on every active `FeedCard` with a `resolvesAt`
- R2. Mobile: time remaining visible in the top-right corner on every active `FeedCard` with a `resolvesAt`
- R3. Halted and resolving markets show the live countdown (not "Ended")
- R4. Text turns `text-red font-medium` when < 1h remaining
- R5. Shows "Ended" when market is ended / resolved / cancelled
- R6. No layout shift when `resolvesAt` is null (renders nothing)
- R7. No regression to bar animation, tap tooltip, or density transitions

## Scope Boundaries

- `MarketHUD` is unchanged — it already has `CountdownTimer` in its status bar
- `ProgressBar` component props are unchanged — time is rendered outside `ProgressBar`
- The existing tap tooltip on the progress bar is not modified
- No new tests required — `FeedCard` and `CountdownTimer` have no existing test files; visual regression is verified manually

## Context & Research

### Relevant Code and Patterns

- `src/components/FeedCard.tsx` — component under modification; has `resolvesAt?: string | null` prop and existing `isEnded` boolean state
- `src/components/CountdownTimer.tsx` — contains `formatTimeRemaining(ms: number): string` (currently module-private); `text-sm` is hardcoded in its className so it cannot be reused directly at `text-[10px]` size
- `isEnded` state in `FeedCard` (lines 269–279): initialized from `new Date(resolvesAt) <= new Date()`, flipped by a `setTimeout` at the deadline — reuse this for the "Ended" display
- Mobile top-right corner: completely free; existing top-left badges use `absolute top-4 left-4 z-10` — match this pattern at `top-4 right-4 z-10`
- Desktop HUD: `ProgressBar` with `showLabels` renders inside a `flex flex-col gap-5` column; time label goes as a sibling `<p>` immediately after `<ProgressBar>`

### Institutional Learnings

- **Hydration safety**: Never initialize `Date.now()` in `useState` or render body — server/client mismatch. Initialize countdown state to `null`, populate in `useEffect`. (See `docs/solutions/ui-bugs/video-audio-cross-layout-bleed.md`)
- **`setInterval` cleanup**: Always return `() => clearInterval(id)` from `useEffect` to prevent leaks on unmount/re-run. (See `docs/solutions/runtime-errors/turbopack-instrumentation-worker-unref-kills-setinterval.md`)
- **Density system**: Do not wrap the mobile top-right label in `DENSITY_BADGE_STYLE` or `DENSITY_LABEL_STYLE` — it must be always visible (requirements §Density). (See `docs/solutions/ui-bugs/mobile-bet-tray-nav-clearance-fixes.md`)
- **State reset in `doStop`**: `timeRemaining` is derived from a prop via `useEffect` and is not interactive UI state — it does not need explicit reset in `doStop()`. Unlike `isBetExpanded`, it carries no user interaction context across deactivate/activate cycles.
- **Stale closure in intervals**: `setInterval` callbacks close over state values at creation time. When the callback needs to read `isEnded`, use a `useRef` synced inside the effect (`isEndedRef.current = isEnded`) so the interval always reads the latest value without relying on React re-renders to reinstall the interval.

## Key Technical Decisions

- **Inline countdown, not `<CountdownTimer>`**: `CountdownTimer` hardcodes `text-sm`; the requirements specify `text-[10px]`. Rather than adding a `className` prop to `CountdownTimer`, export `formatTimeRemaining` as a named export and build a local `useEffect`-driven countdown in `FeedCard`. This avoids prop-drilling into a shared component used by five callers.
- **Single `timeRemaining` state, shared across both layouts**: `useState<number | null>(null)` at FeedCard level. Both the desktop and mobile labels read from the same value — no duplication of interval logic.
- **Adaptive tick interval**: Tick every 60 000 ms when remaining > 1h, every 1 000 ms when ≤ 1h. The transition to per-second ticking is handled by letting the existing effect re-run (which it will when `timeRemaining` passes the 1h threshold triggers an `isUrgent` flip — but since effect deps are only `[resolvesAt, isEnded]`, the implementer should check remaining at each tick and `clearInterval` + restart at the new cadence if urgency boundary is crossed). Simplest correct approach: always tick at 1s; the 60s optimization is optional and can be skipped if it adds complexity.
- **Ref for isEnded in interval callback**: `isEndedRef = useRef(isEnded)` synced at effect entry; read inside callback to avoid stale closure. Without this, the interval installed when `isEnded=false` never self-terminates even after `isEnded` flips to true.
- **Reuse `isEnded` for "Ended" display**: `isEnded` is already managed by FeedCard (timeout fires at deadline). Add `status`-based check inline: `isEnded || status === "resolved" || status === "failed" || status === "cancelled"`.
- **Desktop placement outside `ProgressBar`**: Time label added as a sibling `<p>` in the HUD column after `<ProgressBar showLabels>`, not as a new prop to `ProgressBar`. Keeps `ProgressBar` self-contained (R7).
- **Mobile placement at `absolute top-4 right-4 z-10`**: The corner is completely free. No density style applied — the label renders unconditionally when `resolvesAt` is present and market is not a terminal state.

## Open Questions

### Resolved During Planning

- **Import `CountdownTimer` or inline?**: Inline, with `formatTimeRemaining` exported from `CountdownTimer`. Avoids `text-sm` mismatch and keeps `CountdownTimer`'s caller surface unchanged.
- **Where on desktop?**: Sibling `<p>` after `<ProgressBar>` in the HUD column. ProgressBar remains unchanged.
- **How to drive "Ended" transition?**: Reuse existing `isEnded` state — no second timer needed.
- **Does `timeRemaining` need reset in `doStop`?**: No — it is prop-derived via `useEffect`, not interactive UI state.

### Deferred to Implementation

- **Initial render flash before `useEffect` fires**: `timeRemaining` starts as `null`; the first second has no countdown displayed. Acceptable given the SSR hydration requirement, but the implementer can evaluate whether a `suppressHydrationWarning` approach would allow safe server initialization.
- **Sub-second accuracy**: The `setInterval(fn, 1000)` drifts slightly over time (accumulated ~50ms per minute). Acceptable for display purposes; the implementer may switch to a `Date`-anchored approach if drift becomes noticeable.

## Implementation Units

- [x] **Unit 1: Export `formatTimeRemaining` from CountdownTimer**

**Goal:** Make the time-formatting logic available to `FeedCard` without duplicating it.

**Requirements:** Supporting R1, R2, R4 — consistent format and urgency behavior

**Dependencies:** None

**Files:**
- Modify: `src/components/CountdownTimer.tsx`

**Approach:**
- Change `function formatTimeRemaining` from a module-private declaration to a named export (`export function formatTimeRemaining`)
- No other changes — callers within `CountdownTimer` still reference it directly, and external callers import it by name

**Patterns to follow:**
- `src/components/CountdownTimer.tsx` — existing function signature and return values

**Test scenarios:**
Test expectation: none — this is a pure export change with no behavioral modification; the function logic is unchanged

**Verification:**
- `formatTimeRemaining` is importable from `CountdownTimer.tsx`
- No change to existing `CountdownTimer` component behavior (existing callers unaffected)

---

- [x] **Unit 2: Add countdown state and time labels to FeedCard**

**Goal:** Render a live time-remaining label on desktop (below the progress bar) and on mobile (top-right corner).

**Requirements:** R1, R2, R3, R4, R5, R6, R7

**Dependencies:** Unit 1 (requires `formatTimeRemaining` export)

**Files:**
- Modify: `src/components/FeedCard.tsx`

**Approach:**

*State:*
- Add `const [timeRemaining, setTimeRemaining] = useState<number | null>(null)` — null initial for SSR safety
- Add `const isEndedRef = useRef(isEnded)` — kept in sync with `isEnded` so the interval callback reads a fresh value (avoids stale closure)
- Add `useEffect` keyed on `[resolvesAt, isEnded]`:
  - Sync `isEndedRef.current = isEnded` at the top of the effect
  - If `!resolvesAt || isEnded` — clear any interval, set `timeRemaining` to null, return
  - Otherwise: compute `new Date(resolvesAt).getTime() - Date.now()`, call `setTimeRemaining` immediately (pre-interval paint), then start an adaptive interval:
    - Tick every **60 000 ms** when remaining > 1h (no sub-minute precision needed)
    - Tick every **1 000 ms** when remaining ≤ 1h (per-second countdown)
  - Inside the interval callback: recompute `rem`, call `setTimeRemaining(rem)`, and call `clearInterval(id)` explicitly when `rem ≤ 0 || isEndedRef.current` — do not rely on the effect cleanup alone for timely self-termination
  - Return `() => clearInterval(id)` for cleanup

*Shared display logic (used by both layouts):*
- `showEnded = isEnded || status === "resolved" || status === "failed" || status === "cancelled"`
- `isUrgent = timeRemaining !== null && timeRemaining > 0 && timeRemaining < 1000 * 60 * 60`
- Display text: `showEnded ? "Ended" : timeRemaining !== null && timeRemaining > 0 ? formatTimeRemaining(timeRemaining) + " remaining" : null`

*Desktop (inside the `hidden lg:flex` HUD column):*
- Add a `<p>` element immediately after the `<ProgressBar ... showLabels />` block
- Render only when `resolvesAt && showLabels && (showEnded || timeRemaining !== null)`
- Styling: `text-[10px] tabular-nums mt-[-14px]` at rest (`text-muted`); `text-red font-medium` when `isUrgent` or `showEnded`
- `mt-[-14px]` pulls the label up to sit tightly below the bar's own `mt-1` labels row, matching the visual gap — adjust to taste during implementation

*Mobile (inside the `lg:hidden` layout):*
- Add a `<span>` at `absolute top-4 right-4 z-10`
- Render only when `resolvesAt && (showEnded || timeRemaining !== null)`
- No density style wrapper — always visible
- Styling: `text-[10px] text-white/50` at rest; `text-red font-medium` when `isUrgent || showEnded` (red for both urgency and "Ended" — matches desktop behavior)
- Wrap in `bg-black/40 rounded px-1.5 py-0.5` for legibility against the video — matches the existing mute button's `bg-black/60` pattern

**Patterns to follow:**
- `isEnded` state initialization and `useEffect` timeout pattern (`FeedCard.tsx` lines 269–279) — mirror the null-guard and cleanup approach
- Mobile badge positioning: `absolute top-4 left-4 z-10` (top-left badges) — use the same `top-4` baseline at `right-4`
- `DENSITY_LABEL_STYLE` is applied via `style={DENSITY_LABEL_STYLE[densityState]}` — the new label explicitly does NOT use this

**Test scenarios:**
- Happy path — active market, > 1h remaining: label shows formatted countdown (e.g. "5h 30m remaining"), styled `text-muted` on desktop / `text-white/50` on mobile
- Happy path — active market, < 1h remaining: label turns `text-red font-medium`, shows minutes + seconds (e.g. "45m 10s remaining")
- Happy path — market exactly at deadline (remaining reaches 0): label transitions to "Ended" without flash
- Edge case — `resolvesAt` is null: no label rendered, no empty space, no layout shift
- Edge case — market status is "resolved" / "cancelled" / "failed": shows "Ended" immediately on mount (no countdown)
- Edge case — halted or resolving market: shows the live countdown (not "Ended") — R3
- Edge case — density compact/minimal on mobile: top-right label remains visible (not hidden by `DENSITY_LABEL_STYLE`)
- Edge case — isEnded flips to true mid-session (timeout fires): label transitions from countdown to "Ended" without stale-closure misfiring (isEndedRef keeps interval in sync)
- Edge case — market > 1h remaining: interval ticks every 60s (not every 1s); urgency switch at 1h triggers a new interval at 1s cadence
- Integration — desktop `showLabels` false (e.g. if ProgressBar is used without `showLabels`): time label not rendered on desktop (guard: `showLabels &&`)

**Verification:**
- Desktop: time label visible below the bar row on an active market card; absent when `resolvesAt` is null
- Mobile: time label visible at top-right on an active market card at all density levels; absent when `resolvesAt` is null
- Under 1h remaining: both labels turn red
- Resolved/cancelled markets show "Ended" on both layouts
- No layout shift between cards with and without `resolvesAt`
- Existing tap tooltip behavior unchanged (click ProgressBar → tooltip shows view count + odds only)

## System-Wide Impact

- **Interaction graph:** `FeedCard` gains one new `useEffect` and `useState`. No callbacks, no middleware.
- **Error propagation:** No failure modes — label simply won't render if `resolvesAt` is null or `formatTimeRemaining` returns unexpected values.
- **State lifecycle risks:** `timeRemaining` interval must clear on unmount (handled by `useEffect` cleanup). No risk of stale intervals after scroll-away because React will unmount/remount the component.
- **API surface parity:** `MarketHUD` already shows `CountdownTimer` independently — no parity concern.
- **Unchanged invariants:** `ProgressBar` component interface unchanged; tap tooltip unchanged; `isEnded` and `barAnimate` state logic unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `timeRemaining: null` for the first render tick causes a brief label-absent flash | Acceptable — SSR requirement overrides. Implementer may evaluate `suppressHydrationWarning` as an opt-in |
| `setInterval` drift causes misaligned "Ended" vs `isEnded` | `isEnded` (via existing `setTimeout`) is the authoritative "Ended" trigger; the interval only drives the display value — no conflict |
| Stale closure: interval sees `isEnded=false` after it flips to `true` | Use `isEndedRef` synced at effect entry; interval reads `isEndedRef.current` and calls `clearInterval` immediately when true |
| Interval misses exactly-zero tick due to JS jitter | Callback calls `clearInterval(id)` explicitly when `rem ≤ 0 || isEndedRef.current` — does not wait for React cleanup |
| Mobile top-right label obscures video content or overlaps future UI | Top-right corner was intentionally left free; if crowded in future, the label can be repositioned to match badge styling on the left |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-18-progress-bar-time-remaining-requirements.md](docs/brainstorms/2026-04-18-progress-bar-time-remaining-requirements.md)
- Related code: `src/components/FeedCard.tsx`, `src/components/CountdownTimer.tsx`
- Institutional learnings: `docs/solutions/ui-bugs/mobile-bet-tray-nav-clearance-fixes.md`, `docs/solutions/ui-bugs/video-audio-cross-layout-bleed.md`
