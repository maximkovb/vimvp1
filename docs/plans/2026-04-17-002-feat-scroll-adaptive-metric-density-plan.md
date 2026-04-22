---
title: "feat: Scroll-Adaptive Metric Density (Mobile Feed)"
type: feat
status: completed
date: 2026-04-17
---

# feat: Scroll-Adaptive Metric Density (Mobile Feed)

## Overview

Data density on each `FeedCard` changes automatically as a function of scroll behavior — no toggle needed. A fast swipe collapses the card to video + progress bar only. A slow scroll reveals a compact metric strip. After the snap settles (or after 2s of dwell), the card returns to its full layout. Desktop is unaffected — the side HUD already shows all data.

This is getspike parity feature #6 (highest-complexity item in the series). Features #1–#3 are shipped; #4 (Dense Metrics Drawer) and #5 (Resolution Rules Accordion) are still planned. This feature can ship independently of #4 and #5.

---

## Problem Statement

The feed currently renders the full card layout at all times. During a fast swipe the bottom overlay (channel title, market title, target text, YES/NO buttons) is visible but irrelevant — the user is transitioning, not reading. This visual noise competes with the video. On slower scrolls the user is engaged but there is no mechanism to surface additional context without a mode switch or separate drawer.

---

## Proposed Solution

Attach a `scroll` velocity listener to the existing `feedColumnRef` scroll container in `DiscoverFeed`. Derive a bucketed `density` value (`'minimal' | 'compact' | 'full'`). Dispatch it to the active card via a new `setDensity()` imperative method on `FeedCardHandle` — the same imperative pattern as `activate()`/`deactivate()`, which avoids busting `FeedCard`'s `memo()` wrapper on every scroll tick.

Inside `FeedCard`, density drives conditional rendering with CSS opacity transitions on the affected overlay elements.

---

## Element Visibility Matrix

| Overlay element | `full` | `compact` | `minimal` |
|---|---|---|---|
| Video + scrubber | ✅ | ✅ | ✅ |
| Linear progress bar | ✅ | ✅ | ✅ |
| YES / NO buttons | ✅ | ✅ | ❌ |
| Projection badge | ✅ | ✅ | ❌ |
| Market title | ✅ | ✅ | ❌ |
| Channel title (`@handle`) | ✅ | ❌ | ❌ |
| Target text (`Target: 500K views`) | ✅ | ❌ | ❌ |
| Status badge (halted/resolving) | ✅ | ✅ | ❌ |

**Rationale:** YES/NO buttons are hidden only in `minimal` (fast-swipe) since the user is clearly passing through. In `compact` (slow-scroll, engaged) the conversion action must remain. Channel title and target text are decorative context — removing them in `compact` declutters without losing interactive value.

---

## Technical Approach

### Velocity Thresholds

| State | Trigger |
|---|---|
| `minimal` | Scroll velocity > 150 px/s (fast swipe) |
| `compact` | Scroll velocity 30–150 px/s (slow browse) |
| `full` | Scroll stops (scrollend or 400ms debounce) OR dwell > 2s without scroll |

Thresholds are tunable constants. Empirical adjustment on a physical device is expected after initial ship.

### Architecture: `useScrollVelocity` Hook

New file: `src/hooks/useScrollVelocity.ts`

```typescript
// src/hooks/useScrollVelocity.ts
type Density = 'minimal' | 'compact' | 'full';

export function useScrollVelocity(
  scrollRef: RefObject<HTMLElement | null>
): Density
```

Internals:
- Attaches `scroll` event with `{ passive: true }` to `scrollRef.current` on mount; tears down on unmount.
- Tracks `lastScrollTop: number` and `lastScrollTime: number` in `useRef` (not state — no render on every tick).
- On each `scroll` event: `velocity = |deltaY| / deltaTime` (px/ms → px/s).
- Velocity is bucketed into `Density` via the thresholds above. Only calls `setDensity` (internal state) when the bucket actually changes.
- Reset to `full` via `scrollend` event if supported, or a `400ms` `setTimeout` debounce as fallback.
- Dwell lock: a separate `2000ms` timer (reset on each scroll event) that also sets `full`. This means after 2s of inactivity, `full` is guaranteed regardless of the debounce state.
- On mount: initialize to `'full'` (no scroll events yet → first card loads fully visible).
- Desktop guard: returns `'full'` unconditionally when `window.matchMedia('(min-width: 1024px)').matches` — consistent with existing `matchMedia` pattern in `FeedCard`.

### Architecture: `FeedCardHandle` Extension

`src/components/FeedCard.tsx` — extend the existing interface:

```typescript
export interface FeedCardHandle {
  activate(): void;
  deactivate(): void;
  setDensity(density: 'minimal' | 'compact' | 'full'): void;  // NEW
}
```

`setDensity` implementation (inside `useImperativeHandle`):
- Sets internal `densityState` React state.
- Clears any pending dwell timer (the hook handles the 2s promotion externally; the card does not need its own timer).

`activate()` reset: add `setDensityState('full')` at the top of the existing `activate()` body. This ensures a card that was held in `minimal` while inactive (e.g., scrolled past quickly) enters clean when re-activated.

### Architecture: `DiscoverFeed` Integration

`src/components/DiscoverFeed.tsx`:

```typescript
const density = useScrollVelocity(feedColumnRef);

// Dispatch density to the active card only
useEffect(() => {
  if (sheet.open) return;  // freeze while BetSheet is covering the feed
  const idx = activeIdxRef.current;
  if (idx === -1) return;
  cardRefs.current[idx]?.current?.setDensity(density);
}, [density, sheet.open]);
```

Dispatches only to `activeIdxRef.current` — consistent with the O(1) card-targeting pattern used by `activate()`/`deactivate()`. Non-active cards keep whatever density `activate()` last set them to (`'full'`).

### Architecture: `FeedCard` Conditional Rendering

Internal density state (mobile layout only):

```typescript
const [densityState, setDensityState] = useState<'minimal' | 'compact' | 'full'>('full');
```

CSS approach: `opacity` + `transition: opacity 0.15s ease-out` on affected elements. Because the mobile layout is all `absolute`-positioned, hiding elements via opacity leaves their space occupied — this is acceptable for the bottom overlay since the elements stack top-to-bottom and the buttons are always at the bottom (the outer div is `absolute bottom-0`). Removing channel title and target text via `max-height: 0; overflow: hidden` with a transition is preferred for cleaner collapse. However, since the mobile overlay is `absolute bottom-0 p-5` (bottom-anchored, grows upward), the YES/NO buttons naturally stay at the bottom even when upper items are hidden.

Implementation for each collapsible element:

```tsx
// Channel title — hidden in compact + minimal
<p
  style={{
    maxHeight: densityState === 'full' ? '2rem' : '0',
    overflow: 'hidden',
    opacity: densityState === 'full' ? 1 : 0,
    transition: 'max-height 0.15s ease-out, opacity 0.15s ease-out',
  }}
  className="text-sm text-white/60 mb-1"
>
  @{videoMetadata?.channelTitle ?? "Unknown"}
</p>
```

Same pattern for target text. For YES/NO buttons (hidden only in `minimal`), use `opacity` + `pointer-events: none` (not `max-height`) since height collapse on the button row would be jarring mid-swipe:

```tsx
<div
  style={{
    opacity: densityState === 'minimal' ? 0 : 1,
    pointerEvents: densityState === 'minimal' ? 'none' : 'auto',
    transition: 'opacity 0.1s ease-out',
  }}
  className="flex gap-3"
>
  {/* YES / NO buttons */}
</div>
```

Note: `densityState` only affects the `lg:hidden` mobile layout block. The `hidden lg:flex` desktop block is untouched.

---

## Implementation Phases

### Phase 1 — Hook + Interface (No Visible Change)

**Goal:** Add the hook and extend `FeedCardHandle`. Zero visible UI change; smoke-test with console logging.

Tasks:
- [ ] Create `src/hooks/useScrollVelocity.ts` with `'full'` initial state, `{ passive: true }` scroll listener, `scrollend`/debounce reset, dwell timer, desktop guard
- [ ] Extend `FeedCardHandle` interface with `setDensity(density: Density): void`
- [ ] Add `densityState` useState to `FeedCard`, wire `setDensity` in `useImperativeHandle`
- [ ] Add `setDensityState('full')` reset at top of `activate()` in `FeedCard`
- [ ] Import and call `useScrollVelocity(feedColumnRef)` in `DiscoverFeed`; add `useEffect` that dispatches to `activeIdxRef` card but does nothing visible yet

**Test:** `console.log(density)` in the dispatch effect; scroll fast/slow and verify the bucket transitions on a mobile viewport.

### Phase 2 — FeedCard Conditional Rendering

**Goal:** Wire `densityState` to the mobile layout. Tunable transition speeds.

Tasks:
- [ ] Add `max-height` + `opacity` transitions to channel title (`@handle`) in mobile layout
- [ ] Add `max-height` + `opacity` transitions to target text line in mobile layout
- [ ] Add `opacity` + `pointer-events` transitions to YES/NO button row in mobile layout
- [ ] Add `opacity` + `pointer-events` transitions to top badges block (projection + status) in mobile layout
- [ ] Remove `console.log` from Phase 1
- [ ] Verify `activate()` reset: scroll quickly past a card, then scroll back — card should enter `full` immediately

**Test:** On mobile viewport, swipe fast → card collapses. Swipe slowly → card stays full. Stop → card returns to full.

### Phase 3 — Threshold Tuning + BetSheet Guard

**Goal:** Get the feel right; handle edge cases.

Tasks:
- [ ] Empirical threshold tuning on a physical device (starting values: 150px/s fast, 30px/s slow)
- [ ] Extract `SCROLL_FAST_PX_S`, `SCROLL_SLOW_PX_S`, `SCROLL_SNAP_SETTLE_MS`, `SCROLL_DWELL_MS` as named constants at the top of `useScrollVelocity.ts`
- [ ] Verify BetSheet guard: open BetSheet, swipe the feed behind it — no density flash when sheet closes
- [ ] Verify desktop: `useScrollVelocity` always returns `'full'` on ≥1024px; no `setDensity` calls needed

---

## Alternative Approaches Considered

**Prop-based density (pass `density` prop to `FeedCard`)**
Rejected. `FeedCard` is `memo()`-wrapped; a `density` prop changing on every scroll tick would cause re-renders on every scroll event (the whole card), not just a targeted state update inside `useImperativeHandle`. The imperative `setDensity` pattern isolates the state change inside the card, consistent with how `activate()`/`deactivate()` already work.

**CSS class toggling from outside (`data-density` on the wrapper div)**
Rejected. Would require CSS selectors targeting child elements from a parent data attribute, which breaks the component encapsulation already established by `FeedCard`. Also doesn't integrate with React's transition model.

**`IntersectionObserver` multiple thresholds**
Rejected. The IO fires on visibility percentage crossing, not on time-based velocity. It cannot reliably distinguish a fast swipe from a slow one. Velocity requires `scroll` event deltas, not IO.

**CSS `visibility: hidden` or `display: none` for hiding elements**
Rejected per existing codebase learning (`docs/solutions/ui-bugs/video-audio-cross-layout-bleed.md`): `display: none` does not stop side effects and is not animatable. `visibility: hidden` collapses nothing. `opacity` + `max-height` is the correct approach for animated collapse.

---

## System-Wide Impact

### Interaction Graph

`scroll` event on `feedColumnRef` → `useScrollVelocity` → `density` state change → `useEffect` in `DiscoverFeed` → `cardRefs.current[activeIdx]?.current?.setDensity(density)` → `setDensityState` in active `FeedCard` → conditional CSS in mobile layout.

The existing IntersectionObserver → `activate()`/`deactivate()` chain is untouched and runs in parallel.

### Error & Failure Propagation

`useScrollVelocity` returns `'full'` as fallback in all error cases (no scroll listener attached, SSR, `scrollRef.current` is null). `FeedCard`'s `densityState` initializes to `'full'`. The feature degrades gracefully to always-full layout if the hook fails to initialize.

### State Lifecycle Risks

- **Stale density on re-activation:** Mitigated by `activate()` reset to `'full'`.
- **Dwell timer leaking across unmounts:** `useScrollVelocity` cleans up all timers in its `useEffect` return function.
- **Double-dispatch if two cards are briefly active:** Only `activeIdxRef.current` receives `setDensity` dispatch; the previously active card had `deactivate()` called (which via `activate()` reset will be cleaned up on next re-entry).
- **BetSheet open while density dispatch fires:** Guarded by `if (sheet.open) return` in the dispatch `useEffect`.

### API Surface Parity

`FeedCardHandle` is used only in `DiscoverFeed` — no other component calls `activate()`/`deactivate()`. Adding `setDensity` to the interface does not require changes outside these two files.

No API routes, database schema, or server-side code is affected.

### Integration Test Scenarios

1. **Fast swipe → snap settle:** Swipe fast → `minimal` briefly shown → snap settles → `full` restores within 400ms.
2. **Slow scroll → stop:** Scroll at low velocity → `compact` or `full` → release → snap → `full` confirmed.
3. **BetSheet open during scroll:** Open BetSheet, trigger fast scroll on background — close sheet — verify card is `full`, no stale density.
4. **Scroll past and back:** Fast-swipe past a card → scroll back → card renders `full` (not residual `minimal`).
5. **First page load:** No scrolling yet → first card renders `full` immediately. No flash to `minimal` then back.

---

## Acceptance Criteria

### Functional

- [ ] Fast swipe (> 150px/s) collapses mobile card to video + progress bar only (channel title, target text, status/projection badges, YES/NO buttons hidden)
- [ ] Slow scroll (< 30px/s) shows full card or compact layout per velocity bucket
- [ ] After snap settles (≤ 400ms debounce / `scrollend`), card returns to `full` layout
- [ ] Dwell > 2s without scroll promotes card to `full` if not already
- [ ] On re-activation (scroll back to a card), density resets to `full` regardless of prior state
- [ ] YES/NO buttons remain visible in `compact` density — only hidden in `minimal`
- [ ] Desktop layout (≥ 1024px) is completely unaffected

### Non-Functional

- [ ] Scroll listener uses `{ passive: true }` — no main-thread paint blocking
- [ ] No re-renders of `FeedCard`'s full VDOM on scroll velocity changes (imperative path only)
- [ ] Transitions complete in ≤ 0.15s (fast enough to feel responsive, slow enough to not flash)
- [ ] Thresholds extracted as named constants — tunable without logic changes

### Quality Gates

- [ ] TypeScript: `FeedCardHandle` interface updated, no `any` casts introduced
- [ ] No existing IntersectionObserver behavior regressed (video autoplay, mute, progress animation)
- [ ] Tested on mobile viewport in Chrome DevTools and a physical iOS device

---

## Compact Strip: Future Content (Post Feature #4)

Once feature #4 (Dense Metrics Drawer) ships its schema migration adding likes/comments/shares to `tiktok_polls`, the `compact` density can surface richer content in a 2-column grid strip above the YES/NO buttons:

| Metric | Source |
|---|---|
| Views/hr | Last two `tiktokPolls` rows delta |
| Engagement rate | `(likes + comments) / views` |

These slot into the existing `compact` layout without density-level changes. The compact strip placeholder can render the projection badge + implied probability in MVP, then gain the richer metrics post-migration.

---

## Key Files

| File | Change |
|---|---|
| `src/hooks/useScrollVelocity.ts` | **NEW** — hook returning `Density` |
| `src/components/FeedCard.tsx` | `FeedCardHandle` extension, `densityState`, conditional rendering, `activate()` reset |
| `src/components/DiscoverFeed.tsx` | `useScrollVelocity` import, density dispatch `useEffect`, BetSheet guard |

---

## Dependencies & Prerequisites

- Features #4 and #5 are **not** prerequisites — this feature ships independently.
- The compact strip in MVP uses only already-available props (`priceYes`, `priceNo`, `projectionLabel`, `currentCount`) — no schema changes required.
- No new npm dependencies — all animation via inline CSS transitions consistent with codebase convention.

---

## Risk Analysis

| Risk | Likelihood | Mitigation |
|---|---|---|
| iOS `scroll` events sparse during snap animation | Medium | `scrollend` + 400ms debounce fallback covers the gap; initial swipe velocity is sufficient signal |
| Threshold values feel wrong on device | High | Extracted as named constants; tune in Phase 3 |
| `setDensity` called on wrong card index during fast multi-card swipe | Low | Dispatches only to `activeIdxRef.current` (O(1), same as activate/deactivate) |
| Transition flash on BetSheet close | Low | `sheet.open` guard in dispatch effect prevents density changes while sheet is open |

---

## Sources & References

### Internal

- Wiki: `projects/wiki/projects/virality/pages/features/getspike-parity-features.md` — feature spec §6
- Architecture: `projects/wiki/projects/virality/pages/architecture/video-playback-system.md` — imperative handle pattern, matchMedia routing
- Feature: `projects/wiki/projects/virality/pages/features/doomscroll-feed.md` — IO observer system
- Learning: `docs/solutions/ui-bugs/video-audio-cross-layout-bleed.md` — imperative handle pattern, `display:none` caveat
- Components: `src/components/DiscoverFeed.tsx`, `src/components/FeedCard.tsx`
- Existing hooks: `src/hooks/useMarketData.ts` (hook structure reference)
