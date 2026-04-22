---
title: "feat: Mobile scrubber repositioned and pause-only"
type: feat
status: completed
date: 2026-04-17
origin: docs/brainstorms/2026-04-17-mobile-scrubber-pause-only-requirements.md
---

# feat: Mobile scrubber repositioned and pause-only

Move the video playback scrubber on mobile from the top of the card to the bottom content area (between "Target X views" and the YES/NO buttons), and show it only when the video is paused. Instant snap — no transition.

## Acceptance Criteria

- [ ] The always-visible top-of-card scrubber (`absolute top-0 h-[2px]`) is removed from the mobile layout
- [ ] A scrubber appears inline inside the bottom content block, directly after the "Target: X views" `<p>` and before the YES/NO buttons `<div>`
- [ ] The scrubber is only rendered when `isPaused === true` — it disappears instantly on play and reappears instantly on pause (no CSS transition)
- [ ] The scrubber has `pointer-events-none` so tapping near it does not accidentally open the bet sheet
- [ ] Desktop layout is completely unchanged
- [ ] `progress` resets to `0` inside `handleVideoError` (prevents stale scrubber position on video URL refresh)

## Context

**Only file modified:** `src/components/FeedCard.tsx`

**Pattern to follow:** The play-icon overlay at line 555 uses `{isPaused && (...)}` for instant snap — the same pattern applies here. Do **not** use `DENSITY_BADGE_STYLE` / opacity transitions for this element.

**Spacing:** The "Target:" `<p>` above already has `mb-3`. Add `mb-3` to the scrubber wrapper to give equal spacing on both sides.

## Implementation

### src/components/FeedCard.tsx

**1. Remove** the top-of-card scrubber block (lines 613–619):
```jsx
{/* Video playback scrubber — top of card, TikTok style */}
<div className="absolute top-0 left-0 right-0 h-[2px] bg-white/20 z-20 pointer-events-none">
  <div
    className="h-full bg-white"
    style={{ width: `${progress * 100}%`, transition: 'none' }}
  />
</div>
```

**2. Add** inline scrubber in the bottom content `<div>` (around line 651, after "Target:" `<p>`, before YES/NO `<div>`):
```jsx
{isPaused && (
  <div className="w-full h-[2px] bg-white/20 mb-3 pointer-events-none">
    <div
      className="h-full bg-white"
      style={{ width: `${progress * 100}%`, transition: 'none' }}
    />
  </div>
)}
```

**3. Reset progress on error** — inside `handleVideoError` (~line 368), after `setIsMuted(true)`:
```jsx
setProgress(0);
```

## Edge Cases (from SpecFlow)

- **Pre-activation mount:** `isPaused=true` and `progress=0` on mount, so scrubber renders at 0% width (effectively invisible hairline). Acceptable as-is.
- **Minimal/compact density:** `isPaused` drives visibility. During fast-swipe (minimal density), the card is deactivated so `isPaused` is also `true`, meaning the scrubber is technically visible — but the density labels are already hidden, so this is a minor inconsistency. Acceptable; no density-based hiding needed given `isPaused` semantics align with deactivated state.
- **Video error recovery:** Fixed by `setProgress(0)` in `handleVideoError` (acceptance criterion above).

## Sources

- **Origin document:** [docs/brainstorms/2026-04-17-mobile-scrubber-pause-only-requirements.md](../brainstorms/2026-04-17-mobile-scrubber-pause-only-requirements.md)
  - Key decisions carried forward: (1) instant snap via conditional render, (2) mobile-only, (3) position after "Target" text
- Pattern reference: `FeedCard.tsx:555` — existing `{isPaused && <PlayIcon />}` conditional render
- Learnings: `docs/solutions/ui-bugs/video-audio-cross-layout-bleed.md` — confirms CSS instant-snap is safe for non-media elements
