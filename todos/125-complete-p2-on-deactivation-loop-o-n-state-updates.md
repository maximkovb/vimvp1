---
status: pending
priority: p2
issue_id: "125"
tags: [performance, feed, react, state, code-review]
dependencies: []
---

# O(n) Deactivation Loop Triggers Mass React State Updates on Every Scroll

Every scroll event causes `setIsMuted(true)` + `setIsPaused(true)` to fire on every card in the feed simultaneously, not just the one being deactivated.

## Problem Statement

`DiscoverFeed.tsx:102-104`:

```ts
cardRefs.current.forEach((ref, i) => {
  if (i !== idx) ref.current?.deactivate();
});
```

On every card intersection, this iterates the entire `cardRefs` array and calls `deactivate()` on every non-active card. Each `deactivate()` call executes:
- `v.pause()` (DOM op)
- `v.muted = true` (DOM op)
- `setIsMuted(true)` (React state update → re-render)
- `setIsPaused(true)` (React state update → re-render)

With 20 cards, one scroll event triggers 19 × 2 = 38 React state updates. With 50 cards: 98 updates. On a mid-range Android, this is a frame-rate killer.

In practice, at most one card was ever playing before the scroll. The entire loop is only useful to clean up from edge cases. The correct approach is to track which card is currently active and only deactivate that one.

## Findings

- `DiscoverFeed.tsx:102-104` — loop calls `deactivate()` on all n-1 cards
- Each `deactivate()` in `FeedCard.tsx:162-168` calls `setIsMuted` and `setIsPaused` → 2 re-renders per card
- Performance reviewer confirmed: O(n) state updates per scroll; at 50 cards = 98 simultaneous re-renders
- At most one card can be playing before the scroll — the loop is over-engineered

## Proposed Solutions

### Option 1: Track `activeIdxRef` and deactivate only the previous card (recommended)

**Approach:** Add a `useRef<number>` to track the currently active card index. On intersection, deactivate only the previous card.

```ts
const activeIdxRef = useRef<number>(-1);

// inside observer callback, replace the forEach:
const prev = activeIdxRef.current;
if (prev !== -1 && prev !== idx) {
  cardRefs.current[prev]?.current?.deactivate();
}
activeIdxRef.current = idx;
cardRefs.current[idx]?.current?.activate();
```

Also handle the sentinel (FeedEndGrid):
```ts
if (el === sentinelRef.current) {
  const prev = activeIdxRef.current;
  if (prev !== -1) cardRefs.current[prev]?.current?.deactivate();
  activeIdxRef.current = -1;
  return;
}
```

**Pros:** O(1) deactivation per scroll; eliminates 98% of the spurious state updates
**Cons:** None — the invariant (at most one active card) is guaranteed by the snap-scroll container
**Effort:** Small
**Risk:** Low

---

### Option 2: Keep the loop but batch updates with React 18 automatic batching

**Approach:** React 18 already batches state updates inside event handlers, but IntersectionObserver callbacks are async. Wrap in `flushSync` or `startTransition` to control render scheduling.

**Pros:** No logic change; just scheduling
**Cons:** Still does O(n) DOM ops (`v.pause()`, `v.muted = true`); doesn't fix the root issue
**Effort:** Small
**Risk:** Medium (flushSync misuse can cause layout thrashing)

---

## Recommended Action

Apply Option 1. One-to-one replacement of the 3-line forEach with the activeIdxRef pattern.

## Technical Details

**Affected files:**
- `src/components/DiscoverFeed.tsx:73-74` — add `activeIdxRef`
- `src/components/DiscoverFeed.tsx:86-116` — replace forEach with tracked deactivation

**No database changes needed.**

## Acceptance Criteria

- [ ] Scrolling through the feed produces exactly 1 `deactivate()` call per scroll (not n-1)
- [ ] The newly active card still plays correctly
- [ ] Scrolling to the FeedEndGrid sentinel deactivates the last active card
- [ ] No regression on: fast swipe, scrolling back up, opening bet sheet

## Work Log

### 2026-04-08 - Found during code review

**By:** Claude Code (ce-review)

**Actions:**
- Identified O(n) loop in DiscoverFeed.tsx:102-104
- Performance reviewer flagged as Critical; confirmed that at most 1 card can ever be active
- Designed O(1) fix using `activeIdxRef`

---
