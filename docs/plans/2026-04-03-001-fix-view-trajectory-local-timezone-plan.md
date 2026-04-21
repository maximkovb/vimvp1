---
title: "fix: Display view trajectory timestamps in user's local timezone"
type: fix
status: completed
date: 2026-04-03
---

# fix: Display view trajectory timestamps in user's local timezone

The view count trajectory chart (and price chart) render time-axis labels in UTC because `lightweight-charts` defaults to UTC display for `UTCTimestamp` values. Users in non-UTC timezones see misleading tick marks. The fix is a client-side-only change: pass a `localization.timeFormatter` to each `createChart` call so the browser's own `Intl`/`Date` API converts the Unix timestamp to the viewer's local time.

## Acceptance Criteria

- [ ] Time-axis labels on the **View/Like Count Trajectory** chart reflect the viewer's local timezone
- [ ] Time-axis labels on the **Price History** chart reflect the viewer's local timezone
- [ ] No server-side changes — timezone conversion happens entirely in the browser
- [ ] No new dependencies added

## Context

### How timestamps flow today

1. `youtubePolls` and `priceHistory` rows are stored in Postgres with UTC timestamps.
2. `/api/markets/[id]` returns them as ISO-8601 strings (UTC).
3. `MarketLiveData.tsx` converts them to Unix seconds:
   ```ts
   // src/components/MarketLiveData.tsx:52,61
   time: Math.floor(new Date(p.time).getTime() / 1000) as UTCTimestamp
   ```
4. These values are passed as `{ time, value }[]` to `VideoStatsChart` and `PriceChart`.
5. `lightweight-charts` v5.1 treats `UTCTimestamp` as seconds-since-epoch and renders axis labels in **UTC by default**.

### The fix

`lightweight-charts` v5 accepts a `localization.timeFormatter` callback in `createChart` options. A formatter that calls `new Date(time * 1000).toLocaleTimeString()` (or a richer `toLocaleString`) will use the browser's ambient timezone — no explicit `timeZone` string needed, so each user sees their own local time automatically.

```ts
// Example — VideoStatsChart.tsx
createChart(el, {
  // ...existing options...
  localization: {
    timeFormatter: (time: UTCTimestamp) =>
      new Date(time * 1000).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
  },
});
```

Apply the same pattern to `PriceChart.tsx` for consistency.

## Files to Change

| File | Change |
|---|---|
| `src/components/VideoStatsChart.tsx` | Add `localization.timeFormatter` to `createChart` options |
| `src/components/PriceChart.tsx` | Add `localization.timeFormatter` to `createChart` options |

No other files need to change.

## Sources

- `src/components/VideoStatsChart.tsx` — chart init at line 34
- `src/components/PriceChart.tsx` — chart init at line 19
- `src/components/MarketLiveData.tsx:52,61` — timestamp conversion
- lightweight-charts v5 docs: `localization.timeFormatter` option
