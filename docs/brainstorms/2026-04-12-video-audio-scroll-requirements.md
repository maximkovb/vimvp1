---
date: 2026-04-12
topic: video-audio-scroll
---

# Video / Audio Scroll & Control Bugs

## Problem Frame

Users experience three related audio glitches in the discover feed on both mobile and desktop:

1. **Scroll doesn't mute** — after scrolling to a new card, the previous card's audio sometimes keeps playing.
2. **Visuals pause, audio continues** — pressing the pause button freezes the video visually but audio persists.
3. **Mute button causes overlap** — pressing the mute button produces two simultaneous audio streams rather than silencing one.

All three bugs are inconsistent (timing-sensitive), which points to race conditions and an architectural mismatch between the mobile and desktop layouts.

## Root Causes

**RC1. React's `muted` JSX prop doesn't reliably mute `<video>` elements.**
React uses `setAttribute("muted", "")` internally, but browsers require the `.muted` property. As a result, `TikTokEmbed`'s `autoPlay muted` combination may actually autoplay with audio in certain browsers and OS/browser combos, even though `muted` is set in JSX.

**RC2. `TikTokEmbed` always renders in the DOM, including on mobile.**
The desktop layout (`hidden lg:flex` div in `FeedCard.tsx`) renders a `TikTokEmbed` even on mobile — it is only hidden via CSS. A `display:none` element can still play audio in many browsers. This produces the hidden background audio stream that causes the "overlap" symptom.

**RC3. `activate()` / `deactivate()` have no control over `TikTokEmbed` on desktop.**
The `FeedCardHandle` (`activate`/`deactivate`) only targets `videoRef.current`, which is the native video element in the `lg:hidden` mobile div. On desktop, the visible `TikTokEmbed` is never muted or paused by scroll events. The code even marks this gap with a `TODO(desktop)` comment.

**RC4. `togglePause()` only controls the mobile video.**
On desktop, pausing the hidden mobile video has no effect on the visible and playing `TikTokEmbed`. Audio from the embed continues.

## Requirements

- **R1.** `<video>` elements must be muted via the `.muted` DOM property (not the JSX `muted` prop) on mount and whenever the muted state is initialised or reset. This applies to both `FeedCard` and `TikTokEmbed`.

- **R2.** `TikTokEmbed` must not autoplay or produce audio when its parent layout is visually hidden (i.e., when the mobile layout is active). It must not be rendered at all on mobile, or must be explicitly prevented from playing.

- **R3.** On desktop, `FeedCard`'s `activate()` / `deactivate()` must also control the `TikTokEmbed` video — playing and muting it in sync with IntersectionObserver scroll events.

- **R4.** `togglePause()` must pause/resume the correct video for the active layout (mobile or desktop). On desktop, it should target the `TikTokEmbed` video, not the hidden mobile video.

- **R5.** The mute toggle must control the correct video element for the active layout and must not leave a secondary video playing audibly.

## Success Criteria

- Scrolling away from a card always silences its audio within one scroll snap, on both mobile and desktop.
- Pressing pause always stops audio as well as visuals; pressing play resumes both.
- Pressing the mute button mutes the current card's audio; no second audio stream is audible.
- The bugs are no longer reproducible after repeated rapid scrolling.

## Scope Boundaries

- No change to the existing snap-scroll UX or IntersectionObserver architecture.
- No redesign of the desktop layout structure.
- TikTokEmbed's iframe fallback (when `playUrl` is absent) is out of scope — iframe audio control is not reliably achievable via JS.

## Key Decisions

- **Fix at the source, not the symptom**: Rather than adding defensive mute calls everywhere, we remove the hidden autoplay source (R2) and wire desktop scroll control properly (R3/R4). This is the minimal fix with the lowest carrying cost.
- **R2/R3/R4 implementation approach — Option B chosen**: `FeedCard`'s desktop layout replaces `TikTokEmbed` with a native `<video>` element, so `FeedCardHandle.activate()` / `deactivate()` control a single unified video element path. This eliminates the duplicate control-surface problem and resolves RC3/RC4 without adding API surface to `TikTokEmbed`. `TikTokEmbed` is no longer used inside `FeedCard`; it may still be used elsewhere as a standalone component.

## Dependencies / Assumptions

- The `playUrl` is available for most active markets (the native video path, not the iframe fallback, is the common case).
- A `useMediaQuery('(min-width: 1024px)')` hook (or equivalent) can be added without introducing a new library — Next.js and the existing stack support this natively.

## Outstanding Questions

### Resolve Before Planning
_(none — root causes are confirmed from code review)_

### Deferred to Planning

- **[Affects R2/R3/R4][Technical]** With Option B (native video in desktop layout), determine whether to use one shared `<video>` element (complex CSS) or two separate elements (mobile ref + desktop ref) with a JS media query check in `activate()`/`deactivate()` to control the right one. The two-ref approach is simpler but must ensure the hidden element is always muted/stopped.
- **[Affects R2][Needs research]** Confirm that `useMediaQuery('(min-width: 1024px)')` or `window.matchMedia` (called inside `activate()`/`deactivate()`) does not produce a hydration mismatch. A `mounted` guard or SSR-safe approach may be needed.
- **[Affects R1][Needs research]** Verify which browsers exhibit the React `muted` prop bug and whether a `useEffect` setting `videoRef.current.muted = true` on mount is sufficient, or whether an `onLoadedMetadata` handler is also needed.

## Next Steps

→ `/ce:plan` for structured implementation planning
