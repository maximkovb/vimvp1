---
status: pending
priority: p2
issue_id: "140"
tags: [code-review, performance, scroll-adaptive-density, css]
dependencies: []
---

# maxHeight transitions cause layout recalculation per frame — use opacity/visibility

## Problem Statement

The channel title and target text collapse using `maxHeight: "2rem" → "0"` with a CSS transition. `maxHeight` transitions force the browser to run layout recalculation on every animation frame because it cannot pre-compute intermediate sizes. This breaks compositor-thread-only animation and causes jank visible even at 60fps, especially on mid-range Android devices.

## Findings

- `src/components/FeedCard.tsx` lines ~622–629 (channel title) and ~637–644 (target text)
- Both use: `maxHeight`, `overflow: "hidden"`, `opacity`, `marginBottom` — all transitioning simultaneously
- `maxHeight` animation is the problematic property: the browser must measure content at every frame step
- `marginBottom` transition also triggers layout recalculation
- `opacity` and `transform` are compositor-only (GPU) — zero layout cost
- Since the mobile layout is `absolute bottom-0`, hiding elements via opacity does leave dead vertical space, but this is acceptable: the bottom-anchored div simply appears taller during transition but the YES/NO buttons stay pinned to the bottom

## Proposed Solutions

### Option 1: Replace maxHeight + marginBottom with opacity + visibility (Recommended)

```typescript
// Channel title (and target text — same pattern)
<p
  className="text-sm text-white/60 mb-1"
  style={{
    opacity: densityState === "full" ? 1 : 0,
    visibility: densityState === "full" ? "visible" : "hidden",
    pointerEvents: "none",
    transition: "opacity 0.15s ease-out, visibility 0.15s ease-out",
  }}
>
```

`visibility: hidden` + `opacity: 0` together: the element is invisible and non-interactive but still occupies space. The transition is GPU-composited, zero layout cost. The content area expands slightly (by the line heights of the hidden elements) but since the container is `absolute bottom-0`, this pushes the YES/NO buttons up slightly — which is actually desired (more breathing room when in compact mode).

**Pros:** Zero layout cost; GPU composited; simple
**Cons:** Occupied space not reclaimed (YES/NO buttons shift up ~2 lines in compact)
**Effort:** Small | **Risk:** Low

### Option 2: Fixed-height wrapper with height: 0 transition

Wrap each collapsible element in a div with a fixed known height and transition `height` directly:

```typescript
<div style={{ height: densityState === "full" ? "1.5rem" : "0", overflow: "hidden", transition: "height 0.15s ease-out" }}>
  <p className="text-sm text-white/60 mb-1">@{channelTitle}</p>
</div>
```

**Pros:** Reclaims space; precise sizing
**Cons:** Fixed pixel heights are brittle with font scaling / accessibility zoom; still triggers layout (height transition has the same recalculation cost as maxHeight for variable content)
**Effort:** Small | **Risk:** Medium (fragile with a11y zoom)

## Acceptance Criteria

- [ ] No layout events fire during density transition in Chrome DevTools Performance timeline
- [ ] Channel title and target text animate in/out smoothly at CPU 4x throttle
- [ ] YES/NO buttons remain accessible (not hidden) in compact density

## Work Log

- 2026-04-17: Identified by performance-oracle in ce:review of feat/scroll-adaptive-metric-density
