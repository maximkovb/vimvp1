---
title: "fix: Eliminate cross-layout audio bleed and desktop scroll-mute gap"
type: fix
status: completed
date: 2026-04-12
origin: docs/brainstorms/2026-04-12-video-audio-scroll-requirements.md
---

# fix: Eliminate cross-layout audio bleed and desktop scroll-mute gap

## Overview

Three audio glitches — scroll doesn't mute, visuals pause but audio continues, mute button causes overlap — all trace to the same root: `TikTokEmbed` renders in `FeedCard`'s desktop layout div (`hidden lg:flex`) on every device, including mobile where it is only CSS-hidden. Because React's `muted` JSX prop is unreliable on `<video>` elements and `TikTokEmbed` has `autoPlay`, the hidden embed plays audibly in the background. On desktop the visible `TikTokEmbed` is never wired to `activate()`/`deactivate()`, so scrolling never mutes it.

The fix: replace `TikTokEmbed` inside `FeedCard`'s desktop layout with a native `<video>` element controlled by a second ref (`desktopVideoRef`). Update `activate()`, `deactivate()`, `togglePause()`, and `toggleMute()` to target the correct video based on which layout is active (`window.matchMedia`). Also fix `TikTokEmbed`'s `muted` prop bug so its standalone use on the market detail page doesn't autoplay with sound.

This closes the `TODO(desktop)` comment at `FeedCard.tsx:251`.

## Problem Statement

Prior fix plans already addressed mobile race conditions:
- **2026-04-08**: Built the IntersectionObserver system; scoped desktop out with a `TODO`.
- **2026-04-11**: Fixed `setIsMuted` sync and `playPromiseRef` tracking in `togglePause`.

The remaining bugs are caused by `TikTokEmbed` being uncontrolled:

| Bug | Root cause |
|---|---|
| Scroll doesn't mute (desktop) | `TikTokEmbed` has no `activate()`/`deactivate()` wiring; IO fires, nothing mutes |
| Visuals pause, audio continues (mobile + desktop) | Hidden TikTokEmbed continues playing when mobile `<video>` pauses; visible TikTokEmbed unaffected by `togglePause` |
| Mute button causes overlap | React `muted` prop doesn't set DOM `.muted` property; TikTokEmbed autoplays audibly; `toggleMute()` only mutes the mobile `<video>` |

Key constraint confirmed during research (from `2026-04-08` plan source):
> "Do NOT use the React `muted` prop to toggle mute — it only sets the initial HTML attribute. After mount, always mutate `videoRef.current.muted` directly."

## Proposed Solution

### Change 1 — Add `desktopVideoRef` and `window.matchMedia` routing to `FeedCard`

Add a second `useRef<HTMLVideoElement>(null)` for the desktop layout. Update all four control functions to pick the active video based on `window.matchMedia('(min-width: 1024px)').matches`:

- `activate()` — plays the active layout's video; pauses + mutes the inactive one
- `deactivate()` — pauses and mutes **both** (defensive; ensures no hidden playback)
- `togglePause()` — targets the active layout's video
- `toggleMute()` — targets the active layout's video

`window.matchMedia` is safe to call inside these functions because they are only ever invoked from IntersectionObserver callbacks or user click handlers — both are browser-only execution contexts with no SSR risk.

### Change 2 — Replace `TikTokEmbed` in desktop layout with native `<video>`

Render a `<video ref={desktopVideoRef}>` in the `hidden lg:flex` section instead of `<TikTokEmbed>`. Replicate the same UI overlays already present in the mobile section (mute button, pause icon overlay). Share state (`isMuted`, `isPaused`, `progress`, `currentPlayUrl`) — both layout branches read the same React state.

Both video elements use `key={currentPlayUrl}` so they remount identically when the error-refresh handler updates the URL.

`TikTokEmbed` is removed from `FeedCard` only. It remains used standalone in `src/app/markets/[id]/page.tsx`.

### Change 3 — Fix `TikTokEmbed` muted prop bug

In `TikTokEmbed.tsx`, add a `useEffect` that imperatively sets `videoRef.current.muted = true` after each mount (including remounts via `key` change on `currentPlayUrl`). This ensures autoplay on the market detail page starts muted regardless of whether React correctly synced the `muted` attribute.

## Technical Considerations

### Why two refs and not one

A React `ref` can only attach to one DOM element at a time. If both layout branches render `<video ref={videoRef}>`, only the last-mounted element holds the ref. The two-ref approach avoids this while keeping the existing activation logic structure intact.

### `window.matchMedia` is safe here — no hook needed

`activate()`, `deactivate()`, `togglePause()`, and `toggleMute()` all run in browser-only contexts:
- `activate()`/`deactivate()` are called from `IntersectionObserver` callbacks (browser API).
- `togglePause()`/`toggleMute()` are called from DOM event handlers.

None of these execute during SSR, so there is no hydration risk. No `useMediaQuery` hook or `mounted` guard is required.

### Shared state across both video elements

`isMuted`, `isPaused`, `progress`, and `currentPlayUrl` are shared React state. Both video elements render with identical `src`, `poster`, and event handlers. The `onPause`/`onPlay`/`onTimeUpdate`/`onError` events fire from whichever video is active; since only one layout is visible at a time, UI state stays consistent without layout-specific state.

### `playPromiseRef` remains a single ref

`activate()` sets `playPromiseRef.current` to the promise from whichever video it plays. `deactivate()` awaits that promise before stopping both. This is correct because only one video can be in a pending-play state at any given time.

### Video error handling

`handleVideoError` updates `currentPlayUrl`, which causes both `<video key={currentPlayUrl}>` elements to remount. The remounted videos start muted and stopped — the card is still "active" in the IO sense but `activate()` is not re-called automatically. This is a pre-existing edge case (exists in mobile-only implementation today) and is out of scope for this fix.

## System-Wide Impact

**Interaction graph (after fix):**
```
Scroll → IO callback (DiscoverFeed) → cardRef[i].activate()
  → window.matchMedia → picks desktopVideoRef or videoRef
  → activeV.muted = false → activeV.play()
  → inactiveV.pause() + inactiveV.muted = true
  → setIsMuted(false), setIsPaused(false)
```

**Deactivation:**
```
IO (new card entering) → cardRef[prev].deactivate()
  → playPromiseRef.then(doStop)
  → doStop: videoRef.pause() + muted=true, desktopVideoRef.pause() + muted=true
  → setIsMuted(true), setIsPaused(true)
```

**Mute button (desktop):**
```
user click → toggleMute()
  → window.matchMedia → desktopVideoRef.current.muted = !isMuted
  → setIsMuted(!isMuted)
```

No changes to `DiscoverFeed.tsx`. No changes to the IntersectionObserver threshold, ref array, or sentinel pattern.

## Acceptance Criteria

- [ ] **R1** — Scrolling away from a card silences its audio within one scroll snap on mobile.
- [ ] **R2** — Scrolling away from a card silences its audio within one scroll snap on desktop.
- [ ] **R3** — Pressing pause on the visible video stops audio as well as visuals on both mobile and desktop.
- [ ] **R4** — Pressing the mute button mutes the active video; no second audio stream is audible.
- [ ] **R5** — No overlapping audio when rapidly scrolling through multiple cards.
- [ ] **R6** — Existing mute/pause tap gestures continue to work on mobile.
- [ ] **R7** — `TikTokEmbed` on the market detail page (`/markets/[id]`) autoplays silently (muted) as before.
- [ ] **R8** — The `TODO(desktop): wire IO control` comment is removed.
- [ ] **R9** — No `AbortError` or `NotAllowedError` surfaces to the user.

## Dependencies & Risks

- **Risk — desktop video UI parity:** The new desktop `<video>` section needs a mute button and pause overlay matching the mobile section. Missing controls would degrade desktop UX.
- **Risk — two videos playing simultaneously during resize:** If a user resizes from mobile to desktop (or vice versa) while a card is active, `matchMedia` will return the new layout but neither `activate()` nor `deactivate()` has been called. The previously playing video continues; the new layout's video is paused. This resolves automatically on the next scroll (IO fires and calls `activate()`). Acceptable for now.
- **Risk — `onError` fires on one video only:** Because both videos share the same `currentPlayUrl` state, an error in one triggers a URL refresh that remounts both. Both remount muted/stopped. Acceptable (pre-existing edge case).
- **No CSP changes needed:** `next.config.ts` already allows all TikTok CDN domains in `media-src`.

## Implementation

All changes are confined to two files.

### `src/components/FeedCard.tsx`

#### 1. Add `desktopVideoRef`

```typescript
// After line 149 (videoRef and playPromiseRef declarations)
const desktopVideoRef = useRef<HTMLVideoElement>(null);
```

#### 2. Update `activate()` — pick active video, stop inactive

```typescript
activate() {
  const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
  const activeV = isDesktop ? desktopVideoRef.current : videoRef.current;
  const inactiveV = isDesktop ? videoRef.current : desktopVideoRef.current;
  if (!activeV) return;

  setProgress(0);
  setIsPaused(false);
  activeV.muted = false;
  setIsMuted(false);

  // Ensure the hidden layout's video stays silent
  if (inactiveV) {
    inactiveV.pause();
    inactiveV.muted = true;
  }

  playPromiseRef.current = activeV.play()
    .catch(() => {
      activeV.muted = true;
      setIsMuted(true);
      return activeV.play().catch(() => {});
    });
},
```

#### 3. Update `deactivate()` — stop both videos defensively

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
  if (playPromiseRef.current) {
    playPromiseRef.current.then(doStop).catch(doStop);
    playPromiseRef.current = null;
  } else {
    doStop();
  }
},
```

#### 4. Update `toggleMute()` — target active layout's video

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

#### 5. Update `togglePause()` — target active layout's video

```typescript
function togglePause() {
  const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
  const video = isDesktop ? desktopVideoRef.current : videoRef.current;
  if (!video) return;
  if (video.paused) {
    playPromiseRef.current = video.play().catch(() => {});
  } else {
    const doStop = () => video.pause();
    if (playPromiseRef.current) {
      playPromiseRef.current.then(doStop).catch(doStop);
      playPromiseRef.current = null;
    } else {
      doStop();
    }
  }
}
```

#### 6. Update cleanup `useEffect` — clean both video elements

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

#### 7. Replace `TikTokEmbed` in desktop layout with native `<video>`

Replace the `<TikTokEmbed .../>` block in the `hidden lg:flex` section (around line 255) with:

```tsx
{/* 9:16 video container */}
<div className="relative w-[325px] flex-shrink-0">
  <div className="relative w-full" style={{ paddingBottom: "177.78%" }}>
    {currentPlayUrl ? (
      <>
        <video
          ref={desktopVideoRef}
          key={currentPlayUrl}
          src={currentPlayUrl}
          poster={thumbnailSrc ?? undefined}
          muted={isMuted}
          loop
          playsInline
          preload={priority ? "metadata" : "none"}
          className="absolute inset-0 w-full h-full object-cover rounded-xl cursor-pointer"
          onClick={(e) => { e.stopPropagation(); togglePause(); }}
          onError={handleVideoError}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (v.duration > 0) setProgress(v.currentTime / v.duration);
          }}
          onPause={() => setIsPaused(true)}
          onPlay={() => setIsPaused(false)}
        />

        {/* Pause overlay */}
        {isPaused && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none rounded-xl">
            <div className="rounded-full bg-black/50 p-3">
              <PlayIcon />
            </div>
          </div>
        )}

        {/* Mute toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleMute(); }}
          aria-label={isMuted ? "Unmute" : "Mute"}
          className="absolute bottom-3 right-3 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors z-10"
        >
          {isMuted ? <MutedIcon /> : <UnmutedIcon />}
        </button>
      </>
    ) : thumbnailSrc ? (
      <Image
        src={thumbnailSrc}
        alt={title}
        fill
        className="object-cover rounded-xl"
        priority={priority}
      />
    ) : (
      <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-card to-background" />
    )}
  </div>
</div>
```

Remove the `TikTokEmbed` import from `FeedCard.tsx` if it is no longer used elsewhere in the file.

### `src/components/TikTokEmbed.tsx`

#### Fix `muted` prop via imperative `useEffect`

Add after the existing `useRef` declarations (around line 43):

```typescript
// React's muted JSX prop only sets the HTML attribute, not the DOM property.
// Set the property directly after each mount (including key-driven remounts).
useEffect(() => {
  if (videoRef.current) {
    videoRef.current.muted = true;
  }
}, [currentPlayUrl]);
```

This ensures that on the market detail page, TikTokEmbed always starts muted regardless of the React `muted` prop behaviour.

## Files Modified

| File | Changes |
|---|---|
| `src/components/FeedCard.tsx` | Add `desktopVideoRef`; update `activate`, `deactivate`, `toggleMute`, `togglePause`, cleanup `useEffect`; replace `TikTokEmbed` block with native `<video>`; remove `TikTokEmbed` import |
| `src/components/TikTokEmbed.tsx` | Add `useEffect` to imperatively set `.muted = true` on mount |

No changes to `DiscoverFeed.tsx`, no DB changes, no API changes, no CSP changes.

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-04-12-video-audio-scroll-requirements.md](../brainstorms/2026-04-12-video-audio-scroll-requirements.md)
  — Key decisions carried forward: Option B (native video in desktop, not TikTokEmbed forwardRef); fix React muted prop via imperative `.muted`; two-ref approach with `window.matchMedia` routing; `deactivate()` stops both refs defensively.

### Prior Plans (both completed)

- [docs/plans/2026-04-08-002-feat-scroll-video-autoplay-automute-plan.md](2026-04-08-002-feat-scroll-video-autoplay-automute-plan.md) — Built the IntersectionObserver system; introduced the `TODO(desktop)` this plan resolves
- [docs/plans/2026-04-11-002-fix-video-pause-sound-toggle-plan.md](2026-04-11-002-fix-video-pause-sound-toggle-plan.md) — Fixed mobile `setIsMuted` sync and `playPromiseRef` tracking

### Internal References

- `src/components/FeedCard.tsx:149` — `videoRef` and `playPromiseRef` declarations
- `src/components/FeedCard.tsx:151–187` — existing `activate()` / `deactivate()` — basis for updated versions
- `src/components/FeedCard.tsx:251` — `TODO(desktop)` comment this plan closes
- `src/components/TikTokEmbed.tsx:88–101` — existing `autoPlay muted` video block
- `src/app/markets/[id]/page.tsx:106–112` — standalone `TikTokEmbed` use (unaffected, benefits from muted fix)
- `next.config.ts` media-src — already covers all TikTok CDN domains; no changes needed
