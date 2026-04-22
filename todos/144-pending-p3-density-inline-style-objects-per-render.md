---
status: pending
priority: p3
issue_id: "144"
tags: [code-review, performance, scroll-adaptive-density, react]
dependencies: [140]
---

# Inline style objects recreated on every FeedCard render — extract to static constants

## Problem Statement

Each density-conditional element in `FeedCard`'s mobile layout creates a new style object literal on every render. `FeedCard` uses `memo()` for prop-level comparison, but `densityState` is internal state — so every density change creates 3–5 new style objects. Since `Density` has only three possible values, all the style objects can be precomputed statically outside the component with zero allocation per render.

## Findings

- `src/components/FeedCard.tsx`: ~5 inline `style={{ ... }}` objects per render, each with 3–5 properties
- All style values are pure functions of `densityState` (3 possible values)
- Static record lookup eliminates object allocation and React's style reconciliation diff for unchanged density
- Depends on todo #140 (maxHeight → opacity/visibility) to finalize the style shape before extracting

## Proposed Solutions

### Option 1: Static DENSITY_STYLES record outside component (Recommended)

```typescript
// At module scope, after Density type import:
const BADGE_STYLES: Record<Density, React.CSSProperties> = {
  full:    { opacity: 1, pointerEvents: "auto",  transition: "opacity 0.15s ease-out" },
  compact: { opacity: 1, pointerEvents: "auto",  transition: "opacity 0.15s ease-out" },
  minimal: { opacity: 0, pointerEvents: "none",  transition: "opacity 0.15s ease-out" },
};
const LABEL_STYLES: Record<Density, React.CSSProperties> = {
  full:    { opacity: 1, visibility: "visible", pointerEvents: "auto",  transition: "opacity 0.15s ease-out" },
  compact: { opacity: 0, visibility: "hidden",  pointerEvents: "none",  transition: "opacity 0.15s ease-out" },
  minimal: { opacity: 0, visibility: "hidden",  pointerEvents: "none",  transition: "opacity 0.15s ease-out" },
};
// etc.
```

Usage: `style={BADGE_STYLES[densityState]}`

**Pros:** Zero allocation per render; self-documenting density matrix; easy to tune per-element
**Cons:** Requires finalizing style approach (coordinate with #140)
**Effort:** Small | **Risk:** Low

### Option 2: useMemo per style group

```typescript
const badgeStyle = useMemo(() => ({
  opacity: densityState === "minimal" ? 0 : 1,
  // ...
}), [densityState]);
```

**Pros:** Quick; works before #140 is resolved
**Cons:** Still allocates on density change (3 memos × 3 changes = 9 allocations per card per swipe)
**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] No new object literals created inside FeedCard's render for density-controlled styles
- [ ] All three density states produce correct visual output

## Work Log

- 2026-04-17: Identified by performance-oracle in ce:review of feat/scroll-adaptive-metric-density
