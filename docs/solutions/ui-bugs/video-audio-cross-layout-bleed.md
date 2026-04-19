---
title: "Video audio cross-layout bleed: scroll mute failure, visual-audio desync, mute overlap"
category: ui-bugs
date: 2026-04-12
tags:
  - audio
  - video
  - react
  - nextjs
  - intersection-observer
  - muted-prop
  - css-visibility
  - doomscroll
  - feed
components:
  - src/components/FeedCard.tsx
  - src/components/TikTokEmbed.tsx
symptoms:
  - Previous card audio continues playing after scrolling to a new card
  - Pressing pause freezes video visually but audio continues playing
  - Pressing mute button causes two simultaneous audio streams
problem_type: ui_bug
---

# Video audio cross-layout bleed

## Problem

Three inconsistent audio bugs appeared in the TikTok-style doomscroll feed on both mobile and desktop:

1. **Scroll doesn't mute** — after scrolling to a new card, the previous card's audio kept playing
2. **Visuals pause, audio continues** — pressing pause froze the video visually but audio persisted
3. **Mute button causes overlap** — pressing mute produced two simultaneous audio streams

All three were intermittent, which pointed to a timing or hidden-state issue rather than an obvious logic error.

## Root Cause

Three distinct causes combined:

**1. `TikTokEmbed` in CSS-hidden div always plays audio.**
The desktop layout rendered `<TikTokEmbed>` inside a `hidden lg:flex` div. This div is on-screen for every device including mobile — only hidden via CSS `display:none`. **CSS `display:none` does not stop audio playback.** Browsers actively play audio from hidden elements. On mobile this meant a second invisible audio stream ran alongside the mobile `<video>` controlled by the IntersectionObserver.

**2. React's `muted` JSX prop does not actually mute a `<video>` element.**
React sets `muted` via `setAttribute("muted", "")`, which writes the HTML *attribute*. Browsers control mute state via the `.muted` DOM *property*. The two are not synchronized at runtime after initial render. So `<video autoPlay muted>` in `TikTokEmbed` could play with audio despite the JSX prop being present.

**3. Desktop video had no activation wiring.**
`FeedCard`'s `activate()` / `deactivate()` methods only targeted `videoRef.current` — the mobile `<video>`. The desktop `TikTokEmbed` had no ref exposed to the IO system. Scrolling past a card on desktop never paused or muted the visible video. Pressing the mute button on desktop only muted the hidden mobile element, leaving the desktop element audibly playing.

## Investigation

1. Confirmed audio continued post-scroll by checking which elements were playing — the `TikTokEmbed` inside `hidden lg:flex` was still active after `deactivate()` ran.
2. Traced `activate()`/`deactivate()` — both only operated on `videoRef.current` (mobile). No code path touched the desktop element.
3. Verified `display:none` does not stop media playback via browser devtools.
4. Confirmed the React `muted` attribute vs DOM property discrepancy: `videoElement.muted` returned `false` in the console despite the JSX prop.
5. Traced `toggleMute()` and `togglePause()` — both targeted only `videoRef.current`, no effect on desktop.

## Solution

All changes are in `src/components/FeedCard.tsx` and `src/components/TikTokEmbed.tsx`.

### Step 1 — Add a second ref for the desktop video

```typescript
// FeedCard.tsx — alongside existing videoRef
const desktopVideoRef = useRef<HTMLVideoElement>(null);
```

### Step 2 — Replace `TikTokEmbed` in the desktop layout with a native `<video>`

Remove `TikTokEmbed` and its import entirely. Render a native `<video ref={desktopVideoRef}>` in the `hidden lg:flex` section. Add mute/pause overlays to match the mobile UI.

### Step 3 — Fix `activate()` to route by breakpoint and silence the inactive ref

```typescript
activate() {
  const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
  const activeV = isDesktop ? desktopVideoRef.current : videoRef.current;
  const inactiveV = isDesktop ? videoRef.current : desktopVideoRef.current;
  if (!activeV) return;

  setProgress(0);
  setIsPaused(false);
  activeV.muted = false;       // DOM property — not JSX prop
  setIsMuted(false);

  // Explicitly stop the hidden layout's video to prevent bleed
  if (inactiveV) { inactiveV.pause(); inactiveV.muted = true; }

  playPromiseRef.current = activeV.play()
    .catch(() => {
      activeV.muted = true;
      setIsMuted(true);
      return activeV.play().catch(() => {});
    });
},
```

`window.matchMedia` is safe to call here because `activate()` is only ever invoked from an IntersectionObserver callback — a browser-only execution context with no SSR risk.

### Step 4 — Fix `deactivate()` to stop both refs defensively

```typescript
deactivate() {
  const doStop = () => {
    for (const v of [videoRef.current, desktopVideoRef.current]) {
      if (!v) continue;
      v.pause();
      v.muted = true;
    }
    setIsMuted(true);
    setIsPaused(true);
  };
  // Await pending play() before pausing — prevents AbortError
  if (playPromiseRef.current) {
    playPromiseRef.current.then(doStop).catch(doStop);
    playPromiseRef.current = null;
  } else {
    doStop();
  }
},
```

Iterating both refs ensures no element is left playing regardless of the current breakpoint.

### Step 5 — Fix `toggleMute()` and `togglePause()` to target the active video

```typescript
function toggleMute() {
  const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
  const v = isDesktop ? desktopVideoRef.current : videoRef.current;
  if (!v) return;
  const next = !isMuted;
  v.muted = next;
  setIsMuted(next);
}
```

Same `matchMedia` pattern applied to `togglePause()`.

### Step 6 — Fix React `muted` prop bug in `TikTokEmbed.tsx`

For any remaining uses of `TikTokEmbed` (e.g., `/markets/[id]`), add an imperative `useEffect` to sync the DOM property after each mount:

```typescript
useEffect(() => {
  if (videoRef.current) {
    videoRef.current.muted = true;  // DOM property, not attribute
  }
}, [currentPlayUrl]); // Runs after key-driven remounts too
```

### Step 7 — Update cleanup `useEffect` to tear down both elements

```typescript
useEffect(() => {
  return () => {
    for (const v of [videoRef.current, desktopVideoRef.current]) {
      if (!v) continue;
      v.pause();
      v.removeAttribute("src");
      v.load();
    }
  };
}, []);
```

## Prevention Strategies

- **Never use CSS `display:none` to silence audio/video** — always call `.pause()` and set `.muted = true` directly on the DOM node. Remove the element from the DOM instead of hiding it when you need to stop audio.
- **Never rely on the React `muted` JSX prop for runtime mute control** — it only sets the HTML attribute on initial render. Always use `videoRef.current.muted = true/false` imperatively after mount.
- **When adding a new layout variant that includes a media element, wiring activate/deactivate is part of the same PR** — not optional follow-up work. The `TODO(desktop)` pattern that accumulated here is a warning sign.
- **Any embed component (`TikTokEmbed`, `YoutubeEmbed`, etc.) is assumed to autoplay audio** unless it is explicitly owned by the parent's activation system.
- **Document in a comment which ref controls play/pause/mute** so future editors know the single source of truth.

## Warning Signs (for code review)

- A `<video>` or embed wrapped in a `hidden` / `display:none` div without a corresponding `.pause()` call in the controlling logic
- `muted` as a JSX prop being toggled dynamically via state rather than via a ref's `.muted` property
- An `*Embed` component rendered unconditionally inside a scroll item but not referenced in the `activate()`/`deactivate()` system
- Two layout branches (mobile/desktop) each containing a media element but only one appearing in the activation handler
- `videoRef.current.setAttribute('muted', ...)` instead of `videoRef.current.muted = ...`

## Test Scenarios

- **Scroll-mute smoke test**: Autoplay a video with audio, scroll it fully off screen — confirm no audio is heard. Repeat at mobile viewport width and desktop width.
- **Hidden layout branch audio test**: Resize from mobile to desktop while a video is playing — confirm audio does not double up or continue from the now-hidden layout's element.
- **Mute button DOM property test**: Play a video, click mute, then run `document.querySelector('video').muted` in DevTools — must return `true`.
- **Rapid scroll stress test**: Scroll quickly through five or more feed items — confirm only the currently centered item produces audio and no ghost audio persists.
- **Re-enter viewport test**: Scroll a video off screen (pause/mute), scroll it back into view — confirm it resumes and the mute button state matches actual audio.
- **Initial page load mute test**: Reload the page; before any user interaction, confirm no audio plays and all `<video>` elements have `.muted === true`.

## Related Plans

- `docs/plans/2026-04-08-002-feat-scroll-video-autoplay-automute-plan.md` — Built the IntersectionObserver system; introduced the `TODO(desktop)` this fix resolves. Contains key constraint: "Do NOT use the React `muted` prop to toggle mute."
- `docs/plans/2026-04-11-002-fix-video-pause-sound-toggle-plan.md` — Fixed mobile play/pause race and `playPromiseRef` tracking; the `deactivate()` await-before-pause pattern documented there is extended here to cover both refs.
- `docs/plans/2026-04-12-001-fix-video-audio-cross-layout-bleed-plan.md` — Full implementation plan for this fix.
