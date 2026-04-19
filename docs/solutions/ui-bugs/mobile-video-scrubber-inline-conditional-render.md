---
title: "Mobile scrubber repositioned to bottom content area, visible only when paused"
module: FeedCard
component: mobile-layout
problem_type: ui-bugs
tags: [scrubber, progress-bar, mobile, pause-state, feedcard, visibility]
date: 2026-04-17
severity: low
resolution_time: fast
---

# Mobile Video Scrubber: Inline Conditional Render

## Root Cause

The mobile video playback scrubber was implemented as an `absolute top-0` overlay that rendered unconditionally — always visible at the top of every card regardless of playback state. It lived outside the bottom content block, so repositioning required a structural change, not just a CSS tweak. There was no guard condition: the scrubber rendered whether the video was playing or paused.

---

## Investigation

Three issues identified:

**1. Wrong position:** The scrubber was a sibling element to the bottom content div, absolutely positioned at `top-0` of the card. To place it below "Target X views" it needed to move inside the bottom content block as an inline flow element.

**2. Always-on visibility:** No guard condition — the scrubber rendered unconditionally. The existing pause-state pattern in the file (`{isPaused && <PlayIcon />}` at ~line 555) was not applied to the scrubber.

**3. Stale progress on error:** `handleVideoError()` refreshed the video URL but left `progress` at its last value. After reset, the scrubber would show a stale position until `onTimeUpdate` fired again.

---

## Solution

Three targeted changes to `src/components/FeedCard.tsx`:

### Change 1 — Reset progress on video error (~line 368)

```tsx
setIsMuted(true);
setProgress(0);  // ← added
```

Clears stale scrubber position when the video URL is refreshed after an error.

### Change 2 — Remove the top-of-card scrubber block (was lines 613–619)

```tsx
// REMOVED entirely:
{/* Video playback scrubber — top of card, TikTok style */}
<div className="absolute top-0 left-0 right-0 h-[2px] bg-white/20 z-20 pointer-events-none">
  <div
    className="h-full bg-white"
    style={{ width: `${progress * 100}%`, transition: 'none' }}
  />
</div>
```

### Change 3 — Add inline scrubber inside the bottom content div, after "Target X views" text

```tsx
{/* Video scrubber — only visible when paused */}
{isPaused && (
  <div className="w-full h-[2px] bg-white/20 mb-3 pointer-events-none">
    <div
      className="h-full bg-white"
      style={{ width: `${progress * 100}%`, transition: 'none' }}
    />
  </div>
)}
```

**Pattern used:** Mirrors the existing `{isPaused && <PlayIcon />}` conditional render already used for the pause indicator overlay. This is the established pattern for instant-snap pause-state UI in `FeedCard` — no CSS transition, disappears the moment `activate()` calls `setIsPaused(false)` optimistically before `play()` resolves. The `progress` state from `onTimeUpdate` persists across pause cycles, so the scrubber always reflects accurate playback position when it appears.

---

## Prevention Strategies

### 1. Pause-State UI: Use Conditional Render, Not Style Toggling

In `FeedCard.tsx`, pause-state overlays must use `{isPaused && (...)}` — never `opacity-0/opacity-100`, `hidden`, or density-system classes.

**Rule:** If an element's existence depends on player state (`isPaused`, `isMuted`), gate it with `{state && (...)}`. If its size or prominence depends on density, use the density system. Never mix them.

### 2. Scrubber State Must Stay Coherent with Player State

Treat `{isMuted, progress}` as a unit in error/reset paths. Any `setIsMuted(true)` call in a reset path should be accompanied by `setProgress(0)`.

### 3. Pause-State Overlays Are Read-Only — Always Use `pointer-events-none`

Any `{isPaused && (...)}` block inside the card tap target must carry `pointer-events-none`. The card's tap handler owns the interaction.

### 4. Mobile vs. Desktop Isolation

The mobile `lg:hidden` and desktop `lg:flex` blocks are independent. When adding pause-state UI, audit both. Comment intentional asymmetry explicitly.

### 5. `activate()` Optimistic State

`activate()` calls `setIsPaused(false)` before `play()` resolves — intentional. Keep `setIsPaused(false)` as the first state mutation in `activate()`. Do not defer it into `.then()` or `await`.

---

## Testing Checklist

**Scrubber visibility**
- [ ] Activate a card → scrubber disappears immediately, no flash
- [ ] Tap to pause → scrubber reappears at correct progress position instantly
- [ ] Scrubber is NOT visible on any card in the playing state
- [ ] Scrubber is NOT visible on idle cards that have never been activated
- [ ] Desktop breakpoint is unaffected by mobile changes

**Error & reset paths**
- [ ] Simulate a video load error → scrubber progress resets to 0
- [ ] After error recovery, scrubber starts from 0 and hides on play

**Interaction safety**
- [ ] Tapping the scrubber area while paused does NOT trigger card navigation or BetSheet
- [ ] `pointer-events-none` is present — verify in DevTools computed styles
- [ ] Rapid play/pause taps (5+) → scrubber shows/hides correctly, no stuck state

**Density system non-interference**
- [ ] Full/compact/minimal density changes do NOT affect scrubber visibility
- [ ] No pause-state element uses `DENSITY_LABEL_STYLE` or `DENSITY_BADGE_STYLE`

---

## Related

- `docs/solutions/ui-bugs/video-audio-cross-layout-bleed.md` — `FeedCard` video lifecycle, `activate()`/`deactivate()`, `isPaused` state management; confirms CSS instant-snap is safe for non-media elements
- `docs/brainstorms/2026-04-17-mobile-scrubber-pause-only-requirements.md` — origin requirements
- `docs/plans/2026-04-17-003-feat-mobile-scrubber-pause-only-plan.md` — implementation plan
