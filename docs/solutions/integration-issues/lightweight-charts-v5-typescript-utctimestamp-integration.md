---
title: "lightweight-charts v5 TypeScript Integration — UTCTimestamp Branding and ResizeObserver"
category: integration-issues
date: 2026-03-23
tags:
  - lightweight-charts
  - typescript
  - utctimestamp
  - branded-types
  - resizeobserver
  - chart-rendering
  - responsive-design
problem_type: TypeScript type mismatch with lightweight-charts v5 Time type; window resize listener insufficient for container-level size changes
component: VideoStatsChart, PriceChart
related_modules:
  - src/components/VideoStatsChart.tsx
  - src/components/PriceChart.tsx
  - src/app/markets/[id]/page.tsx
---

# lightweight-charts v5 TypeScript Integration — UTCTimestamp Branding and ResizeObserver

## Symptoms

- `series.setData(data as never)` used to suppress a TypeScript type error (or `as any`)
- TypeScript error: "Argument of type `{ time: number; value: number }[]` is not assignable to parameter of type `{ time: Time; value: number }[]`"
- Chart does not resize when a sidebar opens, a layout shifts, or a flex container changes — only responds to actual window/viewport resize
- Developers blame the chart library for type strictness and reach for `as never` / `as any`

## Root Cause

Two separate issues compounding:

**1. Type mismatch at `series.setData()`**

lightweight-charts v5 uses a branded `UTCTimestamp` type for time values:
```ts
type UTCTimestamp = number & { readonly _utcTimestampBrand: unknown };
```

Components built with `data: { time: number; value: number }[]` fail to match the expected `{ time: Time; value: number }[]` signature. Developers reached for `as never` to silence this — a worse choice than `as any` because it tells the compiler "this value is assignable to *anything*," completely bypassing the type system rather than just opting out of one check.

**2. `window.resize` only fires on viewport changes**

`window.addEventListener("resize", handler)` fires when the browser viewport dimensions change. Layout shifts caused by sidebar open/close, flex reflows, or any other container-level size change do NOT trigger window resize events — leaving the chart frozen at its initial dimensions.

## Solution

### The key insight: cast at the data source, not at the consumer

`UTCTimestamp` is a TypeScript-only branded type with zero runtime overhead. The single `as UTCTimestamp` cast belongs where you *create* the data — when converting `Date.getTime() / 1000` to a Unix timestamp. This single cast propagates correct types through all component props to the library call site, so `series.setData(data)` works without any cast.

### Fix 1 — Update chart component prop types

```ts
// VideoStatsChart.tsx (and PriceChart.tsx)
import {
  createChart,
  type IChartApi,
  type UTCTimestamp,   // ← import the branded type
  ColorType,
  AreaSeries,
} from "lightweight-charts";

interface VideoStatsChartProps {
  data: { time: UTCTimestamp; value: number }[];  // ← UTCTimestamp, not number
  milestone: number;
  metricLabel: "views" | "likes";
}

// Inside useEffect:
series.setData(data);   // ← no cast needed; types match
```

### Fix 2 — Brand timestamps at the data source

```ts
// page.tsx (server component building the data)
import type { UTCTimestamp } from "lightweight-charts";

const chartData = history.map((s) => ({
  time: Math.floor(s.recordedAt.getTime() / 1000) as UTCTimestamp,  // ← cast here
  value: parseFloat(s.priceYes),
}));

const statsChartData = pollHistory.map((p) => ({
  time: Math.floor(p.polledAt.getTime() / 1000) as UTCTimestamp,    // ← cast here
  value: Number(p.viewCount),
}));
```

The `as UTCTimestamp` cast is correct — Unix timestamps (seconds since epoch) are, by definition, UTCTimestamps.

### Fix 3 — Replace `window.resize` with `ResizeObserver`

```ts
// useEffect cleanup section in chart component
chartRef.current = chart;

const observer = new ResizeObserver((entries) => {
  chart.applyOptions({ width: entries[0].contentRect.width });
});
observer.observe(chartContainerRef.current);

return () => {
  observer.disconnect();   // ← always disconnect before remove
  chart.remove();
};
```

`ResizeObserver` fires whenever the observed element's bounding box changes — viewport resize, sidebar toggle, flex reflow, anything.

## Prevention Checklist

When adding or modifying chart components:

- [ ] Data built in `page.tsx` or a data builder uses `as UTCTimestamp` on the time field
- [ ] Chart component prop types use `{ time: UTCTimestamp; value: number }[]`, not `{ time: number; value: number }[]`
- [ ] No `as never`, `as any`, or `as unknown` casts applied anywhere in the chart data pipeline
- [ ] Resize handled via `ResizeObserver`, not `window.addEventListener("resize")`
- [ ] `ResizeObserver` is disconnected in the `useEffect` cleanup before `chart.remove()`

## Gotchas

**`as never` is worse than `as any`**
`as never` says "this value can be assigned to anything" — it defeats the type system more completely than `as any`. If you see it used to silence a chart library error, that's a signal the prop types are wrong, not that the library is broken.

**Type error surfaces in the component, root cause is in `page.tsx`**
When the data is built server-side and passed as props, TypeScript will flag the mismatch in the client component (`series.setData(data)`), but the actual fix belongs in `page.tsx` where the data is constructed. Don't add casts in the component — fix the types at the source.

**Window resize misses container resizes**
Any chart in a layout that can change shape without a viewport resize (sidebar, accordion, tab switch, modal) will appear broken if it only uses `window.addEventListener("resize")`. Use `ResizeObserver` by default for all chart components.

**ResizeObserver cleanup order matters**
Always call `observer.disconnect()` before `chart.remove()`. The observer callback references the chart instance; if the chart is removed first, a late-firing callback will call `applyOptions` on a removed chart, causing errors.

**Zero-width guard**
In a layout where the container may not yet be visible, `ResizeObserver` can fire with `contentRect.width === 0`. Guard if needed:
```ts
const observer = new ResizeObserver((entries) => {
  const width = entries[0].contentRect.width;
  if (width > 0) chart.applyOptions({ width });
});
```

## Test Scenarios

**1. Type mismatch caught at compile time**
Remove the `as UTCTimestamp` cast from `page.tsx`. Verify `tsc --noEmit` reports an error pointing to `page.tsx`, not to the chart component. Restore the cast; verify `tsc --noEmit` is clean.

**2. Responsive resize on container change**
Render a market detail page with the chart visible. Open/close a sidebar or resize a flex container containing the chart (without changing the window size). Verify the chart redraws to match the new container width within one animation frame.

**3. No memory leak on rapid mount/unmount**
Mount and unmount the chart component 10 times rapidly (e.g., via tab navigation). Inspect DevTools → Memory for `ResizeObserver` instance count. Verify it stays at 0 after all unmounts (all observers disconnected).

## See Also

- `docs/solutions/integration-issues/anthropic-claude-api-nextjs-server-action.md` — TypeScript type narrowing patterns (discriminant unions, `satisfies` operator)
- `docs/solutions/integration-issues/youtube-data-api-analytics-contract-generation.md` — YouTube API `fields` projection and silent partial response gotcha
- `docs/solutions/database-issues/nextjs-financial-app-code-review-patterns.md` — BigInt serialization and Drizzle ORM patterns
