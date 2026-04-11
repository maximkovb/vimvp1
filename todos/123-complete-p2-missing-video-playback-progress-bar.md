---
status: pending
priority: p2
issue_id: "123"
tags: [video, ui, progress-bar, mobile, code-review]
dependencies: []
---

# Add Video Playback Progress Bar to Mobile Feed Layout

The mobile FeedCard has no video timeline scrubber. The user expects a standard progress bar (thin bar below the video, advancing with playback).

## Problem Statement

`FeedCard.tsx` mobile layout (lines 273-396) contains no `<input type="range">` or progress indicator for video playback position. The only progress UI is `ProgressRing` (lines 71-101), which tracks the milestone count target (views/likes), not video playback time. 

Users cannot see how far through the video they are, and the "progress bar" that should work per the user's requirement simply doesn't exist.

## Findings

- `FeedCard.tsx:273-396` — entire mobile layout — no `<progress>`, no `<input type="range">`, no animated timeline div
- `ProgressRing` at lines 71-101 is a milestone tracker, not a video timeline
- `<video>` element fires `timeupdate` events (typically 4x/sec) that can drive a progress bar
- No `currentTime` or `duration` state tracked anywhere in the component
- TS reviewer confirmed: missing feature, user explicitly requested it

## Proposed Solutions

### Option 1: Thin non-interactive progress bar (recommended — minimal, standard)

**Approach:** Track `currentTime / duration` via `onTimeUpdate`, render a thin full-width bar above the bottom controls.

```tsx
const [progress, setProgress] = useState(0);

// on <video>:
onTimeUpdate={(e) => {
  const v = e.currentTarget;
  if (v.duration > 0) setProgress(v.currentTime / v.duration);
}}

// In the mobile layout, above the bottom content div:
<div className="absolute bottom-[108px] left-0 right-0 h-0.5 bg-white/20 z-20 pointer-events-none">
  <div
    className="h-full bg-white"
    style={{ width: `${progress * 100}%`, transition: 'none' }}
  />
</div>
```

Key: `transition: 'none'` — CSS transitions on `timeupdate` cause jank because they lag.

**Pros:** Minimal code; standard TikTok-style UX; no scrubbing complexity
**Cons:** Read-only — user cannot seek
**Effort:** Small (30 min)
**Risk:** Low

---

### Option 2: Interactive scrubber with seek

**Approach:** Use `<input type="range">` bound to `currentTime`. On change, set `v.currentTime = value`.

**Pros:** Full seek functionality
**Cons:** More complex; `input[type=range]` styling on mobile is fiddly; seek on looped short videos is rarely useful
**Effort:** Medium
**Risk:** Low

---

## Recommended Action

Apply Option 1. Looped short TikTok-style videos don't need scrubbing — a thin read-only bar is the standard pattern.

## Technical Details

**Affected files:**
- `src/components/FeedCard.tsx` — add `progress` state, `onTimeUpdate` handler, and progress bar div in mobile layout

**New state:** `const [progress, setProgress] = useState(0)` — reset to 0 in `activate()` when video starts.

**No database changes needed.**

## Acceptance Criteria

- [ ] A thin (0.5rem height) white progress bar appears in the mobile feed layout
- [ ] Bar advances smoothly as the video plays (no CSS transition lag)
- [ ] Bar resets to 0 when a new card becomes active
- [ ] Bar does not appear when `currentPlayUrl` is null (thumbnail-only state)
- [ ] Bar is above the YES/NO buttons and does not overlap the bottom content

## Work Log

### 2026-04-08 - Found during code review

**By:** Claude Code (ce-review)

**Actions:**
- Confirmed no video timeline progress bar exists in FeedCard mobile layout
- TS reviewer flagged as IMPORTANT; user explicitly mentioned progress bar in requirements
- Recommended thin non-interactive bar matching TikTok convention

---
