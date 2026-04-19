---
status: pending
priority: p2
issue_id: "139"
tags: [code-review, performance, scroll-adaptive-density, react]
dependencies: []
---

# density React state causes DiscoverFeed re-renders on every scroll density change

## Problem Statement

`useScrollVelocity` returns `density` as React state. Every bucket change (`full → compact → minimal` etc.) schedules a React re-render of `DiscoverFeed`. On a snap swipe between cards, density can cycle `full → minimal → compact → full` multiple times. Each transition is a React scheduler flush competing with the compositor thread during the snap animation — a dropped frame on mid-range Android.

## Findings

- `src/hooks/useScrollVelocity.ts` line 15: `const [density, setDensity] = useState<Density>("full")`
- `src/components/DiscoverFeed.tsx` line 94: `const density = useScrollVelocity(feedColumnRef)` — `density` is in DiscoverFeed scope
- Every density state change → React schedules DiscoverFeed re-render → `useEffect([density, sheet.open])` fires → dispatches to card
- The dispatch (`cardRefs.current[idx]?.current?.setDensity(density)`) does not need to go through React's scheduler — it's an imperative ref call
- `FeedCard.setDensity` already calls `setDensityState` inside the card, which schedules only the card's re-render (correct, isolated)
- DiscoverFeed re-render also re-runs all `useMemo` computations (`pricesByMarketId`, `pollMap`, `positionSet`) unnecessarily

## Proposed Solutions

### Option 1: Move density to a ref + callback pattern (Recommended)

Change `useScrollVelocity` to accept a stable `onDensityChange` callback and track density internally as a ref:

```typescript
export function useScrollVelocity(
  scrollRef: RefObject<HTMLElement | null>,
  onDensityChange: (d: Density) => void
): void {
  const callbackRef = useRef(onDensityChange);
  useEffect(() => { callbackRef.current = onDensityChange; });
  // ... in onScroll:
  if (next !== currentDensityRef.current) {
    currentDensityRef.current = next;
    callbackRef.current(next);
  }
}
```

In `DiscoverFeed`, pass a stable `useCallback` that calls `setDensity` directly on the active card ref:

```typescript
const dispatchDensity = useCallback((d: Density) => {
  if (sheetOpenRef.current) return;
  const idx = activeIdxRef.current;
  if (idx === -1) return;
  cardRefs.current[idx]?.current?.setDensity(d);
}, []);

useScrollVelocity(feedColumnRef, dispatchDensity);
```

`DiscoverFeed` never re-renders for density changes. Only the targeted `FeedCard` re-renders.

**Pros:** Eliminates DiscoverFeed re-renders; eliminates `useEffect([density])` entirely; cleaner data flow
**Cons:** Breaks hook API (no return value); requires a `sheetOpenRef` to track sheet state without adding it to the callback's closure
**Effort:** Medium | **Risk:** Low

### Option 2: Keep state but wrap dispatch in `useCallback` + `startTransition`

Keep density as state but wrap the dispatch in `startTransition` to deprioritize the re-render:

```typescript
import { startTransition } from "react";
// In onScroll:
startTransition(() => setDensity(next));
```

**Pros:** Minimal code change; React scheduler deprioritizes the update during animation
**Cons:** DiscoverFeed still re-renders; `startTransition` semantics may not be available in all components
**Effort:** Small | **Risk:** Low (good quick fix while Option 1 is planned)

## Acceptance Criteria

- [ ] DiscoverFeed does not appear in React DevTools Profiler flamegraph during a scroll gesture
- [ ] Only the active FeedCard re-renders when density changes
- [ ] Snap animation smoothness is unchanged or improved on CPU-throttled test (Chrome 4x throttle)

## Work Log

- 2026-04-17: Identified by performance-oracle in ce:review of feat/scroll-adaptive-metric-density
