---
status: pending
priority: p3
issue_id: "129"
tags: [typescript, code-quality, code-review]
dependencies: []
---

# DiscoverFeed: Empty `GridMarket` Interface + Double `.map()` on `pollData`

Two minor code quality issues in `DiscoverFeed.tsx` that add noise without value.

## Problem Statement

### Issue A: `GridMarket` is an empty interface extension (lines 33-35)

```ts
interface GridMarket extends FeedMarket {
  // same shape, used for the end grid
}
```

`GridMarket` adds no members. It creates a false impression of type distinction between feed cards and grid cards. If the shapes ever diverge, the correct fix is to add the distinct field at that point — not to pre-declare an empty extension.

### Issue B: `pollMap` construction double-maps the array (lines 119-125)

```ts
const pollMap = new Map(
  pollData.map((p) => ({
    marketId: p.marketId,
    viewCount: p.viewCount,
    likeCount: p.likeCount,
  })).map((p) => [p.marketId, p])
);
```

Two `.map()` calls over the same array, creating an intermediate array of plain objects that is immediately discarded. One pass suffices.

## Findings

- `DiscoverFeed.tsx:33-35` — `GridMarket` empty interface
- `DiscoverFeed.tsx:119-125` — chained `.map()` creating throwaway intermediate array
- `DiscoverFeed.tsx:37` — `gridMarkets: GridMarket[]` prop type using the empty interface

## Proposed Solutions

### Fix A: Remove `GridMarket`, use `FeedMarket` directly

```ts
// Delete lines 33-35 entirely
// Change DiscoverFeedProps:
gridMarkets: FeedMarket[];
```

### Fix B: Collapse to single `.map()`

```ts
const pollMap = new Map(
  pollData.map((p) => [p.marketId, p] as const)
);
```

Note: `pollData` already has `marketId`, `viewCount`, `likeCount` on each entry (from `PollData` interface at lines 37-41), so no reshaping needed.

**Effort:** Trivial (5 min total)
**Risk:** None

## Technical Details

**Affected files:**
- `src/components/DiscoverFeed.tsx:33-35, 37, 119-125`

## Acceptance Criteria

- [ ] `GridMarket` interface removed; `gridMarkets` typed as `FeedMarket[]`
- [ ] `pollMap` constructed with a single `.map()` call
- [ ] TypeScript compiles without errors
- [ ] No runtime regression

## Work Log

### 2026-04-08 - Found during code review

**By:** Claude Code (ce-review)

**Actions:**
- TS reviewer identified both issues
- Grouped into a single P3 todo since they're in the same file and both trivial

---
