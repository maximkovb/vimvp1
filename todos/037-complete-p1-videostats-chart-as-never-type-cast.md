---
status: complete
priority: p1
issue_id: "037"
tags: [code-review, typescript, quality]
dependencies: []
---

# `as never` Cast in VideoStatsChart Defeats Type System

## Problem Statement

`VideoStatsChart` uses `series.setData(data as never)` to silence a type mismatch between `{ time: number; value: number }[]` and lightweight-charts' expected `{ time: UTCTimestamp; value: number }[]`. `as never` is worse than `as any` — it tells TypeScript "this value can be assigned to anything" and completely removes type safety at that call site. If the chart library tightens its types or `time` arrives as an unexpected shape, this silently breaks at runtime with no compiler warning.

## Findings

- `src/components/VideoStatsChart.tsx`: `series.setData(data as never)` — `as never` used to force incompatible type assignment
- Root cause: `data` prop is typed as `{ time: number; value: number }[]` but lightweight-charts v5 `AreaSeries.setData` expects `{ time: Time; value: number }[]` where `Time = string | number | BusinessDay | UTCTimestamp`
- The fix is to brand the `time` values as `UTCTimestamp` at the source (where the Unix timestamps are computed in `page.tsx`) and propagate the correct type through the prop
- TypeScript reviewer rated this as a critical, blocking issue

## Proposed Solutions

### Solution A: Brand `time` as `UTCTimestamp` at the data source (Recommended)
```ts
// In page.tsx:
import type { UTCTimestamp } from "lightweight-charts";

const statsChartData = pollHistory.map((p) => ({
  time: Math.floor(p.polledAt.getTime() / 1000) as UTCTimestamp,
  value: Number(...),
}));
```
Update `VideoStatsChartProps` to accept `{ time: UTCTimestamp; value: number }[]` and remove `as never`.
- **Pros**: Correct fix, no cast anywhere, propagates the semantic type
- **Cons**: Requires importing `UTCTimestamp` into `page.tsx`
- **Effort**: Small
- **Risk**: None — UTCTimestamp is a branded number type, not a runtime change

### Solution B: Cast at the call site with `as unknown as Time[]`
Keep `data: { time: number; value: number }[]` but change the cast to `series.setData(data as unknown as { time: Time; value: number }[])`.
- **Pros**: Minimal change
- **Cons**: Still a cast, just less dangerous than `as never`
- **Effort**: Trivial
- **Risk**: Hides the underlying issue

## Recommended Action

Solution A. Brand the `time` values as `UTCTimestamp` at the `page.tsx` map call. Also apply the same fix to `chartData` (price chart data) for consistency.

## Technical Details

- **Affected files**: `src/components/VideoStatsChart.tsx`, `src/app/markets/[id]/page.tsx`
- **Import needed**: `import type { UTCTimestamp } from "lightweight-charts"`

## Acceptance Criteria

- [ ] `series.setData(data as never)` is removed from `VideoStatsChart.tsx`
- [ ] `statsChartData` in `page.tsx` types `time` as `UTCTimestamp`
- [ ] `VideoStatsChartProps.data` is typed as `{ time: UTCTimestamp; value: number }[]`
- [ ] `tsc --noEmit` on `src/` files produces no new errors

## Work Log

- 2026-03-23: Identified by kieran-typescript-reviewer during code review of feat/video-intelligence-panel
