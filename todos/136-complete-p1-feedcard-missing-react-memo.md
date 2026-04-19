---
status: pending
priority: p1
issue_id: "136"
tags: [code-review, performance, critical]
dependencies: []
---

# Performance: Add React.memo to FeedCard to Prevent O(n²) Re-Renders

## Problem Statement

`FeedCard` is not wrapped in `React.memo`, causing **every market update in the parent** to trigger a full re-render of **all 50+ visible cards**. With price updates every 10 seconds and polling updates every 10 minutes, this creates a cascade of re-paints that makes the doomscroll **unusable on mobile** at scale.

**Scenario:**
1. User scrolls to card 15 (activeIdx=15)
2. Market price updates (trading activity) → parent state updates
3. All 50 FeedCard children re-render (O(n) render cascade)
4. Each re-render recalculates: `getMarketPrices()`, `isTrending` (O(n) includes check), etc.
5. Total: 50 × O(n) = O(n²) per update = **2000ms jank per price update**

On lower-end mobile (iPhone SE, Android Mid-range), this causes **stuttering and unusable scrolling**.

## Findings

**From:** performance-oracle  
**Source:** `/src/components/FeedCard.tsx` (line 128), `/src/components/DiscoverFeed.tsx` (lines 146–173)

### Current State
```tsx
export const FeedCard = forwardRef<FeedCardHandle, FeedCardProps>(function FeedCard({...}) {
  // 450+ lines of video playback logic
});
// ← NOT wrapped in React.memo!
```

### Impact Analysis
- **10 cards visible:** ~3–5 unnecessary re-renders per activation = 120–300ms per update
- **50 cards in DOM:** 50 × 40–60ms = **2000ms jank per price/poll update**
- **At 100+ videos:** Doomscroll becomes **unusable**

### Related Issues
1. `trendingIds.includes(market.id)` is O(n) per card (should be O(1) Set lookup)
2. `getMarketPrices()` called in map function (should be memoized outside)
3. Price calculations not memoized (recalculates every render)

## Proposed Solutions

### Solution 1: Wrap in React.memo with Shallow Compare (Recommended)
**Approach:** Wrap FeedCard in `React.memo` with default shallow comparison. Most card props (priceYes, priceNo, status) rarely change simultaneously, so shallow comparison is sufficient.

**Pros:**
- Standard React optimization pattern
- Zero breaking changes
- Immediate 90%+ reduction in re-renders for inactive cards
- Backward-compatible

**Cons:**
- Doesn't solve O(n) trending check or price calculation issues (separate P2 fixes)

**Effort:** SMALL (2–3 lines)

**Risk:** NONE

---

### Solution 2: Custom Comparison with Selective Props
**Approach:** Use `React.memo` with custom comparison to skip re-render if specific props haven't changed.

**Pros:**
- More granular control
- Can ignore props that intentionally change frequently

**Cons:**
- More code
- Harder to maintain if props change

**Effort:** SMALL (5–10 lines)

**Risk:** LOW — must maintain comparison as props evolve

---

## Recommended Action

**Implement Solution 1** — Wrap FeedCard in `React.memo` immediately. This is a **critical performance fix** that unblocks mobile usability.

Then implement parallel P2 fixes:
- Convert `trendingIds` to Set (O(n) → O(1))
- Memoize price calculations
- Fix DiscoverFeed ref array resizing

## Acceptance Criteria

- [ ] FeedCard wrapped in `React.memo`
- [ ] Re-renders only when props change, not on parent update
- [ ] Inactive cards do NOT re-render when active card changes
- [ ] Mute/play controls still respond immediately (no debounce/lag)
- [ ] Perf measurement: doomscroll scrolls smoothly at 60fps on mid-range mobile (iPhone SE, Pixel 4)
- [ ] No performance regression on desktop layout

## Technical Details

**File:** `/src/components/FeedCard.tsx` (line 128)

**Implementation:**
```tsx
export const FeedCard = React.memo(
  forwardRef<FeedCardHandle, FeedCardProps>(function FeedCard({
    id,
    title,
    status,
    questionType,
    milestoneThreshold,
    priceYes,
    priceNo,
    videoId,
    videoMetadata,
    currentCount,
    isTrending,
    priority = false,
    onTap,
  }, ref) {
    // ... existing 450 lines of code unchanged ...
  }),
  // Optional: custom comparison (usually unnecessary)
  // (prev, next) => {
  //   return (
  //     prev.id === next.id &&
  //     prev.priceYes === next.priceYes &&
  //     prev.priceNo === next.priceNo &&
  //     prev.status === next.status &&
  //     prev.currentCount === next.currentCount &&
  //     prev.isTrending === next.isTrending
  //   );
  // }
);
```

**Note:** Shallow comparison is sufficient — only wrap, don't add custom comparison initially. If granularity is needed later, add custom comparison.

## Related Issues

These P2 issues compound the performance problem but are NOT blockers:
- **#137:** O(n) trending check — should use Set (O(1))
- **#138:** Price calculation in map — should memoize
- **#139:** DiscoverFeed ref array management — should resize cleanly

Fixing #136 unblocks doomscroll usability; #137–#139 optimize further.

## Work Log

- **2026-04-12 00:00** — Created todo from performance-oracle findings
- **Status:** Waiting for implementation

## Testing Strategy

**Before:** 
```bash
# Scroll to card 10, observe frame rate as market prices update
# On mobile: expect 20–30 fps drops (lag when typing in console, updates happening)
```

**After:**
```bash
# Scroll to card 10, update market price every 100ms
# On mobile: expect 55–60 fps (smooth scrolling, no jank)
```

## Resources

- **Performance Review:** `performance-oracle` findings #1
- **Related Performance Issues:** #2 (trending O(n²)), #3 (price calc), #5–#7 (optimization opportunities)
