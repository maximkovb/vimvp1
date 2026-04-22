---
title: "fix: Video pause/sound toggle race conditions"
type: fix
status: completed
date: 2026-04-11
origin: docs/brainstorms/2026-04-11-video-pause-sound-toggle-requirements.md
---

# fix: Video pause/sound toggle race conditions

Two bugs in `FeedCard.tsx` (mobile video player) break expected playback behaviour:
sound continues playing after the user pauses, and the first tap on the mute/unmute
button appears to do nothing. Both stem from race conditions between the DOM video
element and React state.

## Root Cause Summary

**Bug 1 — sound after pause** (`src/components/FeedCard.tsx:231`):
`togglePause()` calls `video.pause()` directly without awaiting
`playPromiseRef.current`. If `activate()` is still resolving its `play()` promise,
it resolves *after* `pause()` and restarts the video with audio. The identical race
is already guarded in `deactivate()` (line 178–183) but not in `togglePause()`.

**Bug 2 — mute toggle first-tap no-op** (`src/components/FeedCard.tsx:157–160`):
`activate()` sets `v.muted = false` immediately on the DOM but defers
`setIsMuted(false)` until the play promise resolves. During that window the icon
shows "muted" while audio is already playing. The user's first tap on the button
runs `!isMuted → false`, sets `v.muted = false` (already false), and calls
`setIsMuted(false)` — producing no audible change, just an icon correction. The
button appears broken.

A secondary issue: when `togglePause()` resumes playback via `video.play()` it
does not update `playPromiseRef.current`, so a subsequent `deactivate()` cannot
await that promise and the race can reoccur.

## Acceptance Criteria

- [ ] R1 — Tapping the video to pause stops audio immediately even if tapped within milliseconds of card activation.
- [ ] R2 — After a card activates with sound, the first tap on the sound button correctly mutes (not a no-op).
- [ ] R3 — The mute/unmute icon always reflects the actual DOM `muted` state of the video element.
- [ ] R4 — `playPromiseRef.current` stays current whenever `video.play()` is called, including from `togglePause()`.

## Implementation

All changes are confined to `src/components/FeedCard.tsx`.

### Change 1 — `activate()`: sync `setIsMuted` with DOM

Move `setIsMuted(false)` to be called synchronously alongside `v.muted = false`
(see origin: docs/brainstorms/2026-04-11-video-pause-sound-toggle-requirements.md — Key Decisions).
The `.catch()` reverts both the DOM property and state if autoplay is blocked.

```typescript
// src/components/FeedCard.tsx — activate()
activate() {
  const v = videoRef.current;
  if (!v) return;
  setProgress(0);
  setIsPaused(false);
  v.muted = false;
  setIsMuted(false);                          // ← moved from .then() to here
  playPromiseRef.current = v.play()
    .catch(() => {
      // Autoplay policy blocked unmuted play — fall back to muted
      v.muted = true;
      setIsMuted(true);
      playPromiseRef.current = v.play().catch(() => {});
    });
},
```

### Change 2 — `togglePause()`: await pending promise and track new one

Mirror the `deactivate()` pattern when pausing. Track the new play promise when
resuming so future `deactivate()` calls can guard it.

```typescript
// src/components/FeedCard.tsx — togglePause()
function togglePause() {
  const video = videoRef.current;
  if (!video) return;
  if (video.paused) {
    playPromiseRef.current = video.play().catch(() => {});   // track promise (R4)
  } else {
    const doStop = () => video.pause();
    if (playPromiseRef.current) {
      playPromiseRef.current.then(doStop).catch(doStop);     // await before pausing (R1)
      playPromiseRef.current = null;
    } else {
      doStop();
    }
  }
}
```

## Context

- `deactivate()` already uses the await-then-pause pattern (line 178–183) — this
  change makes `togglePause()` consistent with it.
- `TikTokEmbed.tsx` has its own simpler `togglePause` / `toggleMute` without the
  `activate/deactivate` lifecycle, and is **not** affected by these bugs.
- No changes to `playPromiseRef` type, `deactivate()`, or any other component.

## Sources

- **Origin document:** [docs/brainstorms/2026-04-11-video-pause-sound-toggle-requirements.md](../brainstorms/2026-04-11-video-pause-sound-toggle-requirements.md)
  — Key decisions carried forward: sync `setIsMuted` in `activate()`, mirror `deactivate()` pattern in `togglePause()`.
- Affected file: `src/components/FeedCard.tsx` — `activate()` line 152, `togglePause()` line 231
- Related pattern (deactivate race guard): `src/components/FeedCard.tsx:178–183`
