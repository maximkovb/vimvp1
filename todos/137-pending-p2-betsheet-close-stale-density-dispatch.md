---
status: pending
priority: p2
issue_id: "137"
tags: [code-review, architecture, scroll-adaptive-density]
dependencies: []
---

# BetSheet close dispatches stale density to active card

## Problem Statement

When the BetSheet closes, the density dispatch `useEffect` re-fires and pushes whatever density value was last computed during scrolling (potentially `"minimal"` or `"compact"`) to the active card. The comment says this guard prevents a flash on close, but the `sheet.open` dependency in the effect array is what *causes* the flash.

## Findings

- `DiscoverFeed.tsx` lines 156–161: `useEffect` has `[density, sheet.open]` dependency array
- When `sheet.open` transitions `true → false`, effect re-runs with the current `density` value
- If user scrolled behind the open sheet, `density` may be non-`"full"` — that stale value gets dispatched on close
- The `activate()` reset to `"full"` only fires on IntersectionObserver threshold cross, not on sheet close
- Architecture reviewer confirmed: the two concerns (dispatch on density change; reset on sheet close) are collapsed into one effect incorrectly

## Proposed Solutions

### Option 1: Split into two effects (Recommended)

```typescript
// Only fires when density changes, BetSheet open state is a guard not a trigger
useEffect(() => {
  if (sheet.open) return;
  const idx = activeIdxRef.current;
  if (idx === -1) return;
  cardRefs.current[idx]?.current?.setDensity(density);
}, [density]);

// Explicitly resets to full when sheet closes
useEffect(() => {
  if (sheet.open) return;
  const idx = activeIdxRef.current;
  if (idx === -1) return;
  cardRefs.current[idx]?.current?.setDensity("full");
}, [sheet.open]);
```

**Pros:** Separates concerns cleanly; matches `activate()` reset pattern
**Cons:** Two effects instead of one
**Effort:** Small | **Risk:** Low

### Option 2: Reset inside `closeSheet` callback

Add `cardRefs.current[activeIdxRef.current]?.current?.setDensity("full")` inside the existing `closeSheet` useCallback.

**Pros:** Co-located with the action causing the reset; one fewer effect
**Cons:** `closeSheet` needs access to `cardRefs` and `activeIdxRef` (already in scope)
**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] Opening BetSheet, scrolling behind it, then closing does not flash a non-full density state
- [ ] Density continues to track scroll velocity correctly while sheet is closed
- [ ] `activate()` reset on scroll-back is unaffected

## Work Log

- 2026-04-17: Identified by architecture-strategist in ce:review of feat/scroll-adaptive-metric-density
