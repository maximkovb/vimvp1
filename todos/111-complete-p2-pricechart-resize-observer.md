---
status: pending
priority: p2
issue_id: "111"
tags: [code-review, bug, charts]
dependencies: []
---

# PriceChart uses window.resize — won't respond to sheet open/close

## Problem Statement

`PriceChart` listens to `window.addEventListener("resize")` to resize the chart. But `PriceChart` is rendered inside a vaul bottom sheet. When the sheet opens, the sheet container changes dimensions without any viewport resize event firing. The chart initializes at width 0 (sheet hidden) and never corrects itself when the sheet becomes visible.

This is a documented known pattern in `docs/solutions/integration-issues/lightweight-charts-v5-typescript-utctimestamp-integration.md`.

## Findings

- `src/components/PriceChart.tsx:62-75`: uses `window.addEventListener("resize", handleResize)`, not `ResizeObserver`
- The chart is inside `BetSheet` — a conditionally rendered vaul Drawer
- When the Drawer opens, the container div goes from `display:none` (or 0 width) to its visible size. No `window.resize` fires.
- Learnings agent: documented in `docs/solutions/integration-issues/lightweight-charts-v5-typescript-utctimestamp-integration.md` — "must use ResizeObserver on the chart container element"
- Also documented there: zero-width guard (`if (width > 0)`) to avoid chart errors when the sheet is animating in

## Proposed Solutions

### Option 1: Replace window.resize with ResizeObserver

**Approach:**

```ts
// In PriceChart useEffect
const observer = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const width = entry.contentRect.width;
    if (width > 0) {  // zero-width guard: sheet may be hidden on first callback
      chart.applyOptions({ width });
    }
  }
});
observer.observe(chartContainerRef.current);

return () => {
  observer.disconnect(); // disconnect BEFORE chart.remove()
  chart.remove();
};
```

**Pros:** Chart resizes correctly when sheet opens; handles sheet animation; matches established project pattern
**Cons:** None — ResizeObserver is universally supported in target browsers

**Effort:** 20 minutes
**Risk:** Low

## Recommended Action

Replace `window.addEventListener("resize")` with `ResizeObserver` per the documented project pattern.

## Technical Details

**Affected files:**
- `src/components/PriceChart.tsx:62-75` — replace resize listener with ResizeObserver

**Known pattern:** `docs/solutions/integration-issues/lightweight-charts-v5-typescript-utctimestamp-integration.md`

## Acceptance Criteria

- [ ] PriceChart fills its container width when the BetSheet opens
- [ ] Chart resizes correctly when the device is rotated while the sheet is open
- [ ] No chart errors when the sheet is animating in at 0-width

## Work Log

### 2026-04-05 - Found in code review

**By:** Claude Code (learnings-researcher agent — documented known pattern)
