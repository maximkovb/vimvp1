---
status: pending
priority: p2
issue_id: "138"
tags: [code-review, performance, scroll-adaptive-density]
dependencies: []
---

# Two timers created/cancelled on every scroll event — collapse to one

## Problem Statement

`onScroll` in `useScrollVelocity` calls `clearTimeout` twice and `setTimeout` twice on every scroll event. On iOS during a momentum fling, `scroll` fires at 60–120 events/second. That is 120–240 timer operations per second for what is ultimately one debounce. The `snapSettleTimer` (400ms) and `dwellTimer` (2000ms) serve the same purpose: "after scrolling stops, return to full."

## Findings

- `src/hooks/useScrollVelocity.ts` lines 42–50: `clearTimers()` + two `setTimeout` calls run inside `onScroll`
- Both timers call `resetToFull()` — identical outcome, only delay differs
- iOS scroll events batch at display refresh rate (60–120 Hz), sometimes 5–8 events per frame during snap
- 120–240 timer create/cancel operations per second on the hot path
- The dwell lock (2000ms) is fully subsumed by the snap-settle timer (400ms) — if snap settles first, dwell never fires; if user is stationary, both would fire 1600ms apart doing the same thing

## Proposed Solutions

### Option 1: Single debounce timer, longer delay for dwell (Recommended)

```typescript
let resetTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReset(delay: number) {
  if (resetTimer !== null) clearTimeout(resetTimer);
  resetTimer = setTimeout(resetToFull, delay);
}

// In onScroll:
scheduleReset(SCROLL_SNAP_SETTLE_MS); // 400ms covers snap + acts as dwell

// In onScrollEnd:
if (resetTimer !== null) clearTimeout(resetTimer);
resetToFull();

// In cleanup:
if (resetTimer !== null) clearTimeout(resetTimer);
```

**Pros:** Half the timer operations; cleaner; dwell semantics preserved via the 400ms settle
**Cons:** Dwell lock constant (`SCROLL_DWELL_MS = 2000`) becomes unused — remove or repurpose
**Effort:** Small | **Risk:** Low

### Option 2: Keep two timers but skip if snap already detected

Only start the dwell timer if `scrollend` is not supported (i.e., as a fallback-of-a-fallback).

**Pros:** Preserves original intent
**Cons:** Still has the churn problem on browsers with scrollend; more complex
**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] `onScroll` performs at most one `clearTimeout` and one `setTimeout` call
- [ ] Density still returns to `"full"` within 400ms after scroll stops on all tested browsers
- [ ] No regression to existing snap-settle and dwell behavior

## Work Log

- 2026-04-17: Identified by performance-oracle in ce:review of feat/scroll-adaptive-metric-density
