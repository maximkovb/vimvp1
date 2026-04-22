---
title: Scroll-Driven Video Auto-Play and Auto-Mute
type: feat
status: completed
date: 2026-04-08
---

# Scroll-Driven Video Auto-Play and Auto-Mute

## Overview

When a video card enters the viewport (snap-scroll), it auto-plays with sound **on**. When the user scrolls away, the outgoing card pauses and mutes. When the final feed card scrolls out to reveal the `FeedEndGrid`, that last card also pauses and mutes. This mirrors TikTok's core playback UX and eliminates the current state where every video auto-plays silently from mount regardless of visibility.

## Problem Statement

Currently, every `FeedCard` is initialised with `autoPlay muted` and plays immediately on mount. There is no concept of an "active card." Users hear nothing because all videos are muted forever (or manually tapped), and multiple videos play simultaneously in the background consuming bandwidth and CPU. The feed has no scroll-aware playback lifecycle.

## Proposed Solution

Introduce a **single `IntersectionObserver`** mounted in `DiscoverFeed` that watches each `.feed-card` child. When a card enters the viewport at ≥60% visibility, it is declared "active": `video.play()` is called and `video.muted = false`. When it leaves, `video.pause()` and `video.muted = true` are called. The `FeedEndGrid` snap item is also observed; when it enters at ≥60%, the last `FeedCard`'s video is paused and muted.

This keeps all video state local to `FeedCard` (no state lift needed) by having `DiscoverFeed` hold an array of imperative handles (`useImperativeHandle`) exposed by each `FeedCard`.

---

## Technical Approach

### Architecture

```
DiscoverFeed
  ├── IntersectionObserver (single, on feedColumnRef children)
  ├── cardRefs: React.RefObject<FeedCardHandle>[]   ← imperative handles
  ├── FeedCard[0..N]  (each exposes play/pause/mute/unmute via handle)
  └── FeedEndGrid snap item  (observed as a sentinel)
```

**Key constraint:** Do NOT use the React `muted` prop to toggle mute — it only sets the initial HTML attribute. After mount, always mutate `videoRef.current.muted` directly. Toggling the React prop causes a video re-mount via `key` change.

**Key constraint:** `video.play()` returns a Promise. Always `.catch(() => {})` to silently discard `AbortError` from scroll interruptions.

### Implementation Phases

#### Phase 1 — Expose Imperative Handle from FeedCard (`src/components/FeedCard.tsx`)

1. Define a `FeedCardHandle` interface:
   ```ts
   export interface FeedCardHandle {
     activate: () => void;   // play() + muted=false + setIsMuted(false)
     deactivate: () => void; // pause() + muted=true  + setIsMuted(true)
   }
   ```
2. Convert `FeedCard` to use `forwardRef<FeedCardHandle, FeedCardProps>`.
3. Expose the handle via `useImperativeHandle`:
   ```ts
   useImperativeHandle(ref, () => ({
     activate() {
       const v = videoRef.current;
       if (!v) return;
       v.muted = false;
       setIsMuted(false);
       v.play().catch(() => {});
     },
     deactivate() {
       const v = videoRef.current;
       if (!v) return;
       v.pause();
       v.muted = true;
       setIsMuted(true);
     },
   }));
   ```
4. Remove `autoPlay` from the `<video>` element. Videos should NOT auto-play on mount — the observer drives all playback. Add `preload="metadata"` instead to allow thumbnail poster rendering without starting playback.
5. Keep `muted` HTML attribute (required for browser mount without user gesture).
6. Keep all existing `toggleMute()` / `togglePause()` handlers — user tap gestures still work independently.

> **Note on desktop:** `TikTokEmbed` has its own private `videoRef`. Scroll-driven control does NOT apply to desktop in this plan. Desktop's `TikTokEmbed` path continues its existing behavior (autoPlay muted, user-controlled). Annotate `FeedCard`'s desktop branch with a `// TODO(desktop): wire IO control once TikTokEmbed exposes forwardRef` comment.

#### Phase 2 — Add Observer in DiscoverFeed (`src/components/DiscoverFeed.tsx`)

1. Create a `cardRefs` array: `const cardRefs = useRef<(React.RefObject<FeedCardHandle> | null)[]>([])`.
   - Allocate one ref per `feedMarkets` entry.
   - Pass each ref to its corresponding `<FeedCard ref={cardRefs.current[i]} ... />`.

2. Add a `sentinelRef` for the `FeedEndGrid` wrapper `<div>`.

3. Mount an `IntersectionObserver` in a `useEffect`:
   ```ts
   useEffect(() => {
     const observer = new IntersectionObserver(
       (entries) => {
         entries.forEach((entry) => {
           const idx = Number(entry.target.dataset.cardIndex);
           if (entry.isIntersecting) {
             // Deactivate all others first (handles rapid swipe)
             cardRefs.current.forEach((ref, i) => {
               if (i !== idx) ref?.current?.deactivate();
             });
             if (!isNaN(idx)) {
               cardRefs.current[idx]?.current?.activate();
             }
             // If it's the sentinel (FeedEndGrid), deactivate last card
             if (entry.target === sentinelRef.current) {
               cardRefs.current[feedMarkets.length - 1]?.current?.deactivate();
             }
           }
         });
       },
       { root: feedColumnRef.current, threshold: 0.6 }
     );

     // Observe each snap item
     feedColumnRef.current?.querySelectorAll('[data-card-index]').forEach(el => observer.observe(el));
     if (sentinelRef.current) observer.observe(sentinelRef.current);

     return () => observer.disconnect();
   }, [feedMarkets.length]);
   ```

4. Add `data-card-index={i}` to each `<div className="snap-start h-screen">` wrapper.
5. Add `ref={sentinelRef}` to the `<div className="snap-start min-h-screen">` wrapper around `FeedEndGrid`.

#### Phase 3 — Browser Autoplay Policy Fallback

Browsers block unmuted play until the user has interacted with the page. The `activate()` handle must be hardened:

```ts
activate() {
  const v = videoRef.current;
  if (!v) return;
  // Attempt unmuted play first
  v.muted = false;
  setIsMuted(false);
  v.play().catch(() => {
    // Autoplay policy blocked unmuted play — fall back to muted
    v.muted = true;
    setIsMuted(true);
    v.play().catch(() => {}); // muted play also failed (e.g., no src yet)
  });
},
```

This means the very first card before any user tap may play muted (existing behavior). Once the user taps anything (toggleMute, togglePause, BetSheet open), subsequent `activate()` calls succeed unmuted because the browser policy clears on first interaction.

#### Phase 4 — Cards Without a playUrl

When `currentPlayUrl` is `null`, `FeedCard` renders a thumbnail `<Image>` with no `<video>`. In this case `videoRef.current` is `null`. The `activate()` / `deactivate()` handle implementations already guard with `if (!v) return` — no additional work needed. These cards silently skip playback logic.

---

## Decisions & Defaults

| Question | Decision | Rationale |
|---|---|---|
| Desktop scope | Mobile-only for this plan | `TikTokEmbed` has private state; requires separate `forwardRef` refactor |
| Backwards scroll (Card 3 → Card 2) | Resume from current `currentTime` (no reset) | Simpler; avoids `currentTime = 0` side effect |
| User manual pause vs. scroll-driven | Scroll-driven **wins** on re-entry | Consistent, simpler state model; matches TikTok |
| First-card autoplay policy | Attempt unmuted; fallback to muted | Browser policy can't be bypassed |
| Mute preference scope | Per-card, reset on each activation | Simplest model; no global mute state needed |
| Empty `gridMarkets` | Sentinel still triggers deactivation of last card | Wrapper div still exists even if FeedEndGrid returns null |

---

## System-Wide Impact

### Interaction Graph

Scroll → IO callback → `DiscoverFeed` observer handler → `cardRef[i].current.activate()` → `videoRef.current.muted = false` + `videoRef.current.play()` → React `setIsMuted(false)` re-render (mute button icon only).

Outgoing card: observer `!isIntersecting` is **not** used directly (unreliable with snap scroll). Instead, the entering card's observer fires, and `DiscoverFeed` deactivates all non-active card refs. This avoids a double-fire race.

### Error & Failure Propagation

- `play()` → `AbortError`: caught silently, no UI change.
- `play()` → `NotAllowedError` (autoplay policy): caught in Phase 3 fallback chain, re-plays muted.
- `videoRef.current === null` (no playUrl): `activate()` / `deactivate()` guard returns early, no error.

### State Lifecycle Risks

Each `FeedCard` remains self-contained. `DiscoverFeed` holds only `cardRefs` (refs, not state) — no re-render triggered by activation. The observer callback runs outside React's render cycle; only `setIsMuted()` inside the handle causes a re-render, and only on the active card.

If the page is unmounted (e.g., navigation), `observer.disconnect()` in the effect cleanup prevents stale callbacks.

### Integration Test Scenarios

1. **Scroll Card 0 → Card 1:** Card 0 pauses + mutes, Card 1 plays + unmutes.
2. **Scroll Card N → FeedEndGrid:** Card N pauses + mutes, grid is visible.
3. **Scroll back Card 1 → Card 0:** Card 1 pauses + mutes, Card 0 plays + unmutes.
4. **First load (no prior interaction):** Card 0 falls back to muted play (no error thrown).
5. **Card with null playUrl becomes active:** No crash, static thumbnail visible, no console error.

---

## Acceptance Criteria

- [ ] Scrolling to a video card starts playback with audio on (or muted fallback if browser policy blocks)
- [ ] Scrolling away from a card pauses and mutes it
- [ ] Scrolling back to a previously visited card resumes playback with audio
- [ ] Scrolling past the last feed card to `FeedEndGrid` pauses and mutes the last card
- [ ] Cards with `null` playUrl do not throw or log errors when activated/deactivated
- [ ] Multiple videos do not play simultaneously at any point
- [ ] Desktop layout (`TikTokEmbed`) is unaffected by this change
- [ ] Existing `toggleMute()` / `togglePause()` tap gestures still work correctly
- [ ] No `AbortError` or `NotAllowedError` surfaces to the user or error boundary
- [ ] `BetSheet` open/close does not affect video playback state (existing behavior preserved)

---

## Files to Modify

| File | Change |
|---|---|
| `src/components/FeedCard.tsx` | Add `FeedCardHandle` interface + `forwardRef` + `useImperativeHandle`; remove `autoPlay` from `<video>`; add `preload="metadata"` |
| `src/components/DiscoverFeed.tsx` | Add `cardRefs` array + `sentinelRef`; mount `IntersectionObserver`; add `data-card-index` attributes; add `ref` to `FeedEndGrid` wrapper |

No new files, no DB changes, no API changes.

---

## Dependencies & Risks

- **Risk:** Browser `IntersectionObserver` threshold `0.6` may fire at unexpected scroll positions on very small devices (iPhone SE). Test at 375px width. Lower to `0.5` if needed.
- **Risk:** Removing `autoPlay` from `<video>` means that on very slow networks the first IO firing may race with `src` being set. Mitigated by `preload="metadata"` which loads enough for play to start quickly.
- **Dependency:** `feedColumnRef` must be the `root` for the observer — if the scroll container changes in a future refactor, update the observer root accordingly.

---

## Sources & References

### Internal References

- Scroll container: `src/components/DiscoverFeed.tsx:101–140`
- FeedCard video state: `src/components/FeedCard.tsx:138–183`
- FeedEndGrid: `src/components/FeedEndGrid.tsx:33–66`
- Proven mute pattern: `docs/plans/2026-04-02-003-feat-video-preview-controls-plan.md` — "set `muted` imperatively via `videoRef.current.muted`, NOT by toggling the React prop"
- Autoplay/error pattern: `docs/plans/2026-04-05-001-feat-doomscroll-natural-video-side-hud-plan.md` — `play().catch(() => {})` pattern

### External References

- [MDN IntersectionObserver](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)
- [Chrome Autoplay Policy](https://developer.chrome.com/blog/autoplay/)
