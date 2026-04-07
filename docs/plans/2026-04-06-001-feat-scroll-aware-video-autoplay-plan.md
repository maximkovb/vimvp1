---
title: "feat: Scroll-Aware Video Autoplay — Pause/Mute on Scroll Away, Play/Unmute on Scroll To"
type: feat
status: active
date: 2026-04-06
---

# feat: Scroll-Aware Video Autoplay

## Overview

When a user scrolls the discover feed, the video they scroll away from should automatically pause and mute. The video they scroll to should automatically play with sound on. This mirrors the TikTok/Reels UX standard: one video playing with audio at a time, driven by scroll position.

## Problem Statement

Currently all `FeedCard` components are mounted simultaneously in the `snap-y snap-mandatory` scroll container. Every card's `<video>` element has `autoPlay muted loop`, meaning:

- All videos play simultaneously in the background (wasted bandwidth, battery drain)
- All videos start muted — the user has to manually tap the mute icon to hear sound
- Scrolling past a card does not pause it
- There is no concept of an "active" card at the feed level

The result is a poor UX: silent videos, no audio feedback on scroll, and wasted resources playing off-screen content.

## Proposed Solution

### Architecture

Introduce an **active-index** at the `DiscoverFeed` level, tracked via `IntersectionObserver` on each card's snap wrapper div. Pass `isActive: boolean` down to `FeedCard` → `useVideoPlayer`. The hook manages play/pause/mute imperatively when `isActive` changes.

```
DiscoverFeed
  activeIndex (state)          ← driven by IntersectionObserver
  │
  ├── FeedCard (isActive=true)  ← playing, unmuted
  ├── FeedCard (isActive=false) ← paused, muted
  └── FeedCard (isActive=false) ← paused, muted
```

### Why IntersectionObserver over scroll event

The container uses `snap-y snap-mandatory`, so at rest exactly one card occupies the viewport. `IntersectionObserver` with `root: feedColumnRef.current` and `threshold: 0.7` fires precisely when a card becomes the dominant visible item — no arithmetic on `scrollTop` needed, works correctly on all browsers including iOS Safari.

### Why not a global/context-based approach

All video state currently lives in `useVideoPlayer`. Threading `isActive` as a parameter to that hook is the minimal, co-located change. A React context for "currently playing videoId" would be clean but is heavier than needed for a snap-scroll feed where only one card can be active.

## Technical Approach

### Files to change

| File | Change |
|---|---|
| `src/components/DiscoverFeed.tsx` | Add `activeIndex` state + `IntersectionObserver` setup; pass `isActive` to each `FeedCard` |
| `src/components/FeedCard.tsx` | Accept `isActive` prop; pass to `useVideoPlayer`; remove `autoPlay` and static `muted` attrs |
| `src/hooks/useVideoPlayer.ts` | Accept `isActive: boolean` param; add `useEffect` to play/unmute on true, pause/mute on false |
| `src/components/TikTokEmbed.tsx` | Accept `isActive` prop; pass to `useVideoPlayer` (desktop path parity) |

### `DiscoverFeed.tsx` changes

Add `activeIndex` state (default `0` — first card starts active) and an `IntersectionObserver` that watches each card's wrapper div. Use `data-index` attributes on the wrappers so the observer callback can identify which card became visible.

```tsx
// src/components/DiscoverFeed.tsx

const [activeIndex, setActiveIndex] = useState(0);

useEffect(() => {
  const container = feedColumnRef.current;
  if (!container) return;

  const observer = new IntersectionObserver(
    (entries) => {
      // Find the entry with the greatest intersection ratio — the card most in view
      const best = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (best) {
        const idx = parseInt(best.target.getAttribute("data-index") ?? "0", 10);
        setActiveIndex(idx);
      }
    },
    { root: container, threshold: 0.7 }
  );

  const cards = container.querySelectorAll("[data-feed-card]");
  cards.forEach((el) => observer.observe(el));

  return () => observer.disconnect();
}, []); // eslint-disable-line react-hooks/exhaustive-deps — feedColumnRef is stable
```

Add `data-feed-card data-index={index}` to each card wrapper div, and pass `isActive={index === activeIndex}` to each `FeedCard`.

### `useVideoPlayer.ts` changes

Add `isActive: boolean` parameter. Add a `useEffect` that drives play/pause/mute imperatively when it changes. Remove the need for `autoPlay` by playing on `isActive → true`.

```ts
// src/hooks/useVideoPlayer.ts

export function useVideoPlayer(videoId: string, isActive: boolean) {
  // ...existing state...

  // Drive playback and audio from the active state set externally by the feed
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isActive) {
      // Unmute first — then play. Browsers require muted=false before audio can start.
      video.muted = false;
      setIsMuted(false);
      video.play().catch(() => {
        // Autoplay policy fallback: if play() rejects (e.g. no user gesture yet),
        // keep muted and try again — browsers allow muted autoplay.
        video.muted = true;
        setIsMuted(true);
        video.play().catch(() => {});
      });
      setIsPaused(false);
    } else {
      video.pause();
      video.muted = true;
      setIsMuted(true);
      setIsPaused(true);
    }
  }, [isActive]);

  // ...rest of hook unchanged...
}
```

**Important:** The existing `useEffect` that syncs `isMuted → videoRef.current.muted` must run *after* the `isActive` effect to avoid overwriting. Since both have different deps (`[isMuted]` vs `[isActive]`), React runs them in declaration order — put the `isActive` effect first in the hook so the muted-sync effect can correct if needed.

### `FeedCard.tsx` changes

1. Add `isActive: boolean` to `FeedCardProps`
2. Pass `isActive` to `useVideoPlayer(videoId, isActive)`
3. Remove `autoPlay` and `muted` from the `<video>` JSX — the hook's `isActive` effect owns playback from now on. (`muted` is still managed imperatively by the hook via `videoRef.current.muted`.)

```tsx
// Before
<video autoPlay muted loop playsInline ... />

// After
<video loop playsInline ... />
```

4. Remove `autoPlay` and `muted` from `TikTokEmbed`'s internal `<video>` element for the same reason.

### `TikTokEmbed.tsx` changes

1. Add `isActive: boolean` to `TikTokEmbedProps` (default `false` for uses outside the feed, e.g. the market detail page)
2. Pass it to `useVideoPlayer(videoId, isActive)`
3. `FeedCard`'s desktop layout already passes props to `TikTokEmbed` — add `isActive={isDesktop === true && isActive}` to that call (only relevant when desktop layout is rendered)

## Technical Considerations

### Browser autoplay policy

Browsers block unmuted autoplay before a user gesture. The `isActive` effect handles this with a two-step fallback:
1. Try to play unmuted
2. If `play()` rejects, fall back to muted play (browser allows muted autoplay)
3. The user still gets sound once they've interacted with the page (the first tap counts)

### React `muted` prop quirk

React does not propagate the `muted` DOM attribute on re-renders (known React bug, documented in existing `useVideoPlayer.ts` comment). The hook already handles this imperatively via `videoRef.current.muted = isMuted`. Removing the static `muted` HTML attribute from JSX is correct — the hook is the sole authority on muted state.

### First-card default

`activeIndex` initializes to `0`. The first `FeedCard` receives `isActive=true` immediately, so it plays with sound as soon as the page hydrates. Subsequent cards are `isActive=false` and start paused/muted.

### Market detail page (`/markets/[id]`)

`TikTokEmbed` is also rendered on the market detail page (`src/app/markets/[id]/page.tsx:102`). That call should pass `isActive={true}` so the video autoplays with sound on that page. The default of `false` would prevent it from playing, which is wrong.

### End grid card

The `FeedEndGrid` is the last snap item. When it scrolls into view, `activeIndex` advances past the last `FeedCard` index, so all cards become `isActive=false` and pause. No special handling needed.

### `useIsDesktop` interaction

On mobile (`isDesktop !== true`), `FeedCard` renders its own `<video>` — `isActive` controls it directly via `useVideoPlayer`. On desktop (`isDesktop === true`), `FeedCard` renders `TikTokEmbed` which has its own `useVideoPlayer` — `isActive` must be forwarded. The mobile `useVideoPlayer` in `FeedCard` is still instantiated even on desktop (hooks can't be conditional) but its video ref is never attached to a DOM element, so the `isActive` effect's `videoRef.current` check (`if (!video) return`) makes it a no-op.

## Acceptance Criteria

- [ ] Scrolling from card A to card B pauses and mutes card A's video
- [ ] Card B's video plays with sound on as soon as it snaps into view
- [ ] Works on mobile (primary path) — `<video>` in `FeedCard`
- [ ] Works on desktop — `<video>` in `TikTokEmbed`
- [ ] The first card in the feed plays with sound on page load (after first user gesture)
- [ ] Manual pause/play via the VideoControls still works — tapping pause while card is active pauses it; tapping play resumes it
- [ ] Manual mute/unmute via the VideoControls still works independently of scroll state
- [ ] Scrolling to the end grid pauses the last video
- [ ] Market detail page (`/markets/[id]`) video still autoplays with sound (isActive defaults to true there)
- [ ] No console errors from unhandled `play()` promise rejections
- [ ] No memory leaks — IntersectionObserver disconnects on `DiscoverFeed` unmount

## Dependencies & Risks

| Risk | Mitigation |
|---|---|
| iOS Safari autoplay with sound blocked until user gesture | Two-step play fallback: unmuted → muted if rejected. First user tap anywhere unlocks audio. |
| IntersectionObserver fires during fast scroll before snap settles | `threshold: 0.7` requires 70% visibility before firing — mid-scroll the card won't hit this threshold |
| Multiple entries arriving in the same observer callback (batch) | Sort by `intersectionRatio` and take the best — prevents thrashing to wrong index |
| Desktop: mobile `useVideoPlayer` effect fires with null ref | Guard `if (!video) return` already in the hook — no-op on desktop |

## Sources & References

- Feed scroll container: `src/components/DiscoverFeed.tsx:73,101–116`
- Video hook: `src/hooks/useVideoPlayer.ts:1–69`
- Muted DOM sync quirk: `src/hooks/useVideoPlayer.ts:15–20`
- Video element (mobile): `src/components/FeedCard.tsx:237–248`
- Video element (desktop): `src/components/TikTokEmbed.tsx:43–60`
- VideoControls (stateless): `src/components/VideoControls.tsx:49–90`
- Market detail TikTokEmbed call: `src/app/markets/[id]/page.tsx:102`
- MDN IntersectionObserver: https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver
