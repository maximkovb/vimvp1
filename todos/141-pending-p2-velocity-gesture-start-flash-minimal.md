---
status: pending
priority: p2
issue_id: "141"
tags: [code-review, performance, scroll-adaptive-density, ux]
dependencies: []
---

# deltaTime ≤ 4ms guard flashes minimal density at start of every gesture

## Problem Statement

When `deltaTime <= 4ms`, `useScrollVelocity` substitutes `SCROLL_FAST_PX_S + 1 = 151 px/s` as the velocity, which immediately buckets to `"minimal"`. On iOS the first scroll event after touch-start fires with a very small `deltaTime` because the event timestamp and `performance.now()` diverge on initial fire. Result: every scroll gesture — including slow deliberate ones — briefly flashes to `"minimal"` (all overlay content hidden) before settling into the real velocity.

## Findings

- `src/hooks/useScrollVelocity.ts` line ~56: `const velocityPxS = deltaTime > 4 ? (deltaY / deltaTime) * 1000 : SCROLL_FAST_PX_S + 1;`
- `SCROLL_FAST_PX_S + 1 = 151` immediately triggers `"minimal"` density
- iOS first-event `deltaTime` is often 1–3ms (native timestamp jitter)
- User experience: a slow deliberate swipe still momentarily collapses all card overlays at gesture start
- The correct behavior for unmeasurable velocity is to preserve the current density, not assume worst-case

## Proposed Solutions

### Option 1: Skip density update when deltaTime is too small (Recommended)

```typescript
function onScroll() {
  const now = performance.now();
  const scrollTop = el!.scrollTop;
  const deltaY = Math.abs(scrollTop - lastScrollTop);
  const deltaTime = now - lastScrollTime;

  lastScrollTop = scrollTop;
  lastScrollTime = now;

  if (deltaTime <= 4) {
    // Unmeasurable window — reschedule reset without changing density
    scheduleReset(SCROLL_SNAP_SETTLE_MS);
    return;
  }

  const velocityPxS = (deltaY / deltaTime) * 1000;
  // ... bucket and setDensity as before
}
```

**Pros:** No false flash; preserves current density during unmeasurable frames
**Cons:** Slightly delayed density response on the very first event of a gesture (negligible: next event arrives within one frame)
**Effort:** Small | **Risk:** Low

### Option 2: Require two consecutive high-velocity readings before switching to minimal

Add a `consecutiveHighVelocityCount` ref that must reach 2 before `"minimal"` is applied.

**Pros:** Eliminates single-event false positives
**Cons:** Adds state; 1-frame lag for legitimate fast swipes
**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] A slow deliberate swipe does not flash to `"minimal"` at gesture start
- [ ] A fast swipe still transitions to `"minimal"` within the first two scroll events
- [ ] `deltaTime <= 4` path tested with simulated low-deltaTime events

## Work Log

- 2026-04-17: Identified by performance-oracle in ce:review of feat/scroll-adaptive-metric-density
