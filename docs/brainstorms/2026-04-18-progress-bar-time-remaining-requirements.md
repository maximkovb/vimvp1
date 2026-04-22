# Progress Bar — Time Remaining Display

**Date:** 2026-04-18  
**Status:** Ready for planning  
**Scope:** Lightweight

---

## Problem

The progress bar on `FeedCard` encodes view progress and YES/NO odds, but gives no indication of how long the market is open for. Users have no way to sense urgency or time pressure without tapping into the market detail page.

## Goal

Surface time remaining on the feed so users can immediately gauge market urgency without any extra tap or navigation. Placement differs by layout: desktop shows it below the bar; mobile shows it in the top-right corner of the card.

---

## Behavior

### What to show

- Text label: `Xh Ym remaining` (same format as existing `CountdownTimer`)
- Counts down live (updates every second)
- Urgency threshold: turns `text-red font-medium` when under 1 hour remaining — same token `CountdownTimer` uses
- Shows `Ended` when time expires (static, no tick)

### When to show

| Condition | Behaviour |
|-----------|-----------|
| `resolvesAt` is present, market active or halted/resolving | Show live countdown |
| `resolvesAt` is null | Show nothing — render `null`, not an empty wrapper, so no layout height is contributed |
| Market ended / resolved / cancelled | Show `Ended` (static, no tick) |

### Desktop

The existing `showLabels` line below the bar renders:
```
1.2M / 2M views · YES 64% · NO 36%
```
Time remaining appears on a **second `<p>` element** directly beneath that, styled `text-[10px] text-muted` (urgent: `text-red font-medium`). Rendered only when `showLabels && resolvesAt && !isEmpty`.

### Mobile

Time remaining is displayed as a **small persistent label in the top-right corner** of the card — positioned alongside or near the existing top-right area (above the video). Styled `text-[10px] text-white/50` at rest; `text-red font-medium` when under 1 hour.

- This is **not** placed below the progress bar on mobile
- Always visible at all density levels (full, compact, minimal) — it is positioned independently of `DENSITY_LABEL_STYLE`
- The existing tap tooltip on the progress bar is **not changed** (no time added to it)

### Density (mobile)

The top-right time label must **not** be wrapped in or governed by `DENSITY_LABEL_STYLE` or `DENSITY_BADGE_STYLE`. It should be independently positioned and always visible when `resolvesAt` is present.

---

## Scope

**In scope**
- `FeedCard.tsx` — time label added to desktop HUD below `ProgressBar`'s `showLabels` row; separate top-right label added to mobile layout
- Both layouts count down live and apply urgency styling at < 1h

**Out of scope**
- `MarketHUD` — already has `CountdownTimer` in its status bar; no change needed
- Tap tooltip (`ProgressBar` on-click tooltip) — not modified
- `ProgressBar` component props — time is rendered outside `ProgressBar` on mobile; on desktop it can be inside `ProgressBar`'s own JSX or in the HUD section that calls it with `showLabels`

---

## Files Likely Touched

| File | Change |
|------|--------|
| `src/components/FeedCard.tsx` | Add time label below `ProgressBar` in desktop HUD; add top-right time label to mobile layout |

---

## Success Criteria

- Time remaining visible below the bar on every active desktop feed card that has a `resolvesAt`
- Time remaining visible in the top-right corner on every active mobile feed card that has a `resolvesAt`
- Halted and resolving markets show the live countdown (not "Ended")
- Turns `text-red font-medium` when < 1h remaining
- Shows `Ended` when market is ended / resolved / cancelled
- No layout shift when `resolvesAt` is null (renders nothing)
- No regression to bar animation, tap tooltip, or density transitions
