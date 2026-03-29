---
status: complete
priority: p2
issue_id: "044"
tags: [code-review, performance, ux]
dependencies: []
---

# `VideoStatsChart` Width Fixed at Mount — No ResizeObserver

## Problem Statement

`VideoStatsChart` initializes the chart with `width: containerRef.current.clientWidth` at mount time and never updates it. If the container is resized (window resize, sidebar toggle, mobile orientation change), the chart stays at its initial pixel width — either overflowing or displaying with stale dimensions. `PriceChart` presumably handles this correctly; `VideoStatsChart` should follow the same pattern.

## Findings

- `src/components/VideoStatsChart.tsx` `useEffect`: `width: containerRef.current.clientWidth` set once at mount
- No `ResizeObserver` or `window.resize` listener in the effect
- On mobile or when the trading panel layout shifts, the chart will be visually broken
- Performance oracle identified this; `PriceChart` likely has the correct pattern to follow

## Proposed Solutions

### Solution A: Add ResizeObserver (Recommended)
```ts
useEffect(() => {
  if (!containerRef.current) return;
  const container = containerRef.current;

  const chart = createChart(container, {
    width: container.clientWidth,
    height: 200,
    // ... rest of options
  });

  const series = chart.addSeries(AreaSeries, { /* ... */ });
  series.setData(data);
  // ... milestone line setup ...
  chart.timeScale().fitContent();

  const observer = new ResizeObserver((entries) => {
    const { width } = entries[0].contentRect;
    chart.applyOptions({ width });
  });
  observer.observe(container);

  return () => {
    observer.disconnect();
    chart.remove();
  };
}, [data, milestone, metricLabel]);
```
- **Pros**: Chart always matches container width; standard browser API; follows PriceChart pattern
- **Cons**: None
- **Effort**: Small
- **Risk**: Low — `ResizeObserver` is well-supported

### Solution B: Use `chart.timeScale().applyOptions()` with window resize event
- **Pros**: Simpler
- **Cons**: Window events don't fire for container-level resizes; inferior to ResizeObserver
- **Effort**: Trivial but incomplete

## Recommended Action

Solution A. Check how `PriceChart` handles this and mirror the pattern exactly.

## Technical Details

- **Affected files**: `src/components/VideoStatsChart.tsx`

## Acceptance Criteria

- [ ] `VideoStatsChart` renders at the correct width when the window is resized
- [ ] ResizeObserver is disconnected in the cleanup function
- [ ] Chart width updates smoothly without remounting (no full `chart.remove()` + recreate on resize)

## Work Log

- 2026-03-23: Identified by performance-oracle during code review of feat/video-intelligence-panel
