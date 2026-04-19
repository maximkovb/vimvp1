---
date: 2026-04-17
topic: mobile-scrubber-pause-only
---

# Mobile: Pause-Only Scrubber Repositioned Under Target Text

## Problem Frame

On mobile, the video playback scrubber is currently pinned to the very top of the card (TikTok-style, always visible). The user wants it moved to the bottom content area — positioned directly below the "Target: X views" label and above the milestone progress bar — and hidden while the video is playing (only visible when paused).

## Requirements

- R1. The top-of-card scrubber (`top-0` 2px bar) is removed from the mobile layout.
- R2. A scrubber bar replaces it in the bottom content block, positioned immediately after the "Target: X views" line and before the milestone `ProgressBar`. It is vertically equal-spaced relative to both neighbours.
- R3. The scrubber is invisible (`display: none` or `visibility: hidden`) while the video is playing, and visible when the video is paused (`isPaused === true`). No fade transition — the change is instant.
- R4. Desktop layout and the milestone `ProgressBar` are unchanged.

## Success Criteria

- Scrubbing the position visually tracks correctly when paused.
- No scrubber is visible at the top of the card on mobile.
- The scrubber appears instantly on pause and disappears instantly on play resume.
- Desktop layout is unaffected.

## Scope Boundaries

- Mobile only (`<1024px` / the `lg:hidden` block in `FeedCard`).
- No changes to desktop layout, `ProgressBar`, or any other card element.
- No fade transition for show/hide.

## Key Decisions

- **Instant visibility toggle**: User preference — no transition, snap on/off with pause state.
- **Position**: Between "Target: X views" text and milestone `ProgressBar`, inside the existing bottom content block.

## Next Steps

→ `/ce:plan` for structured implementation planning
