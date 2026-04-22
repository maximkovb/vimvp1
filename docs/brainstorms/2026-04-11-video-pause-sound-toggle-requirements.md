---
date: 2026-04-11
topic: video-pause-sound-toggle
---

# Video Pause & Sound Toggle Bug Fixes

## Problem Frame

Two bugs in `FeedCard.tsx` (mobile video player) break expected playback controls:

1. **Sound continues after pause** — clicking the video to pause it stops the frame but audio keeps playing.
2. **Sound toggle first click is a no-op** — the mute/unmute button appears to do nothing on the first tap after a card becomes active.

## Root Causes (identified via code analysis)

- **Pause bug**: `togglePause()` calls `video.pause()` without awaiting `playPromiseRef.current`. If a play promise is still pending (e.g., the card was just activated), it resolves after `pause()` and restarts the video with audio. The same race is already handled in `deactivate()` but not in `togglePause()`.
- **Toggle bug**: In `activate()`, `v.muted = false` is set immediately but `setIsMuted(false)` is deferred until the play promise resolves. During that window, the DOM is unmuted but React state says `isMuted=true`. The icon shows "muted" while audio plays; the user's first tap appears to do nothing because it only syncs the icon. Also, `togglePause()` calls `video.play()` but never updates `playPromiseRef.current`, so later `deactivate()` calls won't handle that promise's race.

## Requirements

- R1. Pausing the video (tap on video) stops both video and audio immediately with no race condition — even if tapped immediately after the card activates.
- R2. The mute/unmute button icon always reflects the actual audio state of the video element.
- R3. The mute/unmute button correctly toggles audio on the first tap after a card activates.
- R4. `playPromiseRef.current` is kept up-to-date whenever `video.play()` is called (including from `togglePause()`), so `deactivate()` can always await the most recent play promise.

## Success Criteria

- Tapping a playing video stops audio immediately; no sound bleeds through after pause.
- After a card activates with sound, the first tap on the sound button correctly mutes (not a no-op).
- Tapping the sound button alternates between muted and unmuted reliably on every subsequent tap.

## Scope Boundaries

- Mobile layout in `FeedCard.tsx` only — desktop uses `TikTokEmbed`, which is a separate component with simpler logic and is not reported broken.
- No changes to play/pause UX or mute UX beyond fixing the bugs described above.

## Key Decisions

- **Fix mute state sync in `activate()`**: Set `setIsMuted(false)` synchronously alongside `v.muted = false`, rather than deferring to the play-promise callback. Fall back to muted in the catch. This eliminates the icon-state desync window.
- **Fix `togglePause()` race**: Await `playPromiseRef.current` before calling `pause()`, mirroring the existing pattern in `deactivate()`. Update `playPromiseRef.current` when `togglePause()` calls `video.play()`.

## Next Steps

→ `/ce:plan` for structured implementation planning
