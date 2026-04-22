---
status: pending
priority: p1
issue_id: "122"
tags: [video, audio, mute, state, code-review]
dependencies: ["120"]
---

# `setIsMuted(false)` Called Optimistically Before Browser Confirms Unmuted Play

The mute icon flashes to "unmuted" immediately when scrolling to a new card, then snaps back to "muted" if the browser blocks unmuted autoplay — visible icon flicker and misleading UI state.

## Problem Statement

`FeedCard.tsx:153-159`:

```ts
activate() {
  const v = videoRef.current;
  if (!v) return;
  v.muted = false;
  setIsMuted(false);   // ← optimistic: UI shows unmuted immediately
  v.play().catch(() => {
    v.muted = true;
    setIsMuted(true);  // ← corrected only on rejection
    v.play().catch(() => {});
  });
},
```

`setIsMuted(false)` fires synchronously before `v.play()` is even called. On mobile browsers (iOS Safari, Chrome Android) that enforce autoplay policy, unmuted autoplay is blocked on most pages until a direct user gesture. The `.catch()` fires after a micro/macro-task delay. During that window, a render commit has already shown the "unmuted" icon. On slow devices this flicker is noticeable (50-200ms). More critically, if a re-render occurs between `setIsMuted(false)` and the rejection (e.g., parent state changes), the component can briefly render with the wrong icon baked into the next paint.

Combined with todo 120 (play/pause race), if `deactivate()` is called while the rejection is pending, `isMuted` can end up permanently `false` even though the video is muted.

## Findings

- `FeedCard.tsx:153-154` — `v.muted = false` + `setIsMuted(false)` called before `v.play()`
- `FeedCard.tsx:156-159` — rejection handler sets muted back, but a render has already committed
- On iOS Safari and Chrome Android: unmuted autoplay is blocked until user has engaged with the page (tap/scroll gesture that triggers a user activation)
- The learnings researcher confirmed: "Videos must start with `muted` attribute to satisfy browser autoplay policy. Unmuting requires a prior user gesture."
- When todo 120 is fixed (deactivate awaits playPromise), this becomes even more important — the `setIsMuted(false)` before `.play()` means the icon is wrong during the async await window

## Proposed Solutions

### Option 1: Set `isMuted` only after play resolves (recommended)

**Approach:** Move `setIsMuted(false)` inside the `.then()` callback and keep `setIsMuted(true)` in the `.catch()`. This ensures the icon always reflects actual audio state.

```ts
activate() {
  const v = videoRef.current;
  if (!v) return;
  v.muted = false;
  playPromiseRef.current = v.play()
    .then(() => setIsMuted(false))
    .catch(() => {
      v.muted = true;
      setIsMuted(true);
      playPromiseRef.current = v.play().catch(() => {});
    });
},
```

**Pros:** Icon always reflects true audio state; no flicker
**Cons:** Tiny delay (~1 frame) before icon updates on successful unmuted play
**Effort:** Trivial (move one line)
**Risk:** Low

---

### Option 2: Keep optimistic update but add loading/pending state

**Approach:** Add a third state (e.g., `isMutedPending`) during the play promise window, rendering a neutral icon.

**Pros:** Feels responsive
**Cons:** Extra state complexity; the "pending" icon is confusing to users
**Effort:** Medium
**Risk:** Medium

---

## Recommended Action

Apply Option 1. Bundle this fix with todo 120 (play promise tracking) since they modify the same code block.

## Technical Details

**Affected files:**
- `src/components/FeedCard.tsx:149-169` — `useImperativeHandle` activate block

**No database changes needed.**

## Acceptance Criteria

- [ ] Mute icon does not flash unmuted → muted when scrolling to a new card on a browser that blocks unmuted autoplay
- [ ] Mute icon correctly shows muted when `activate()` falls back to muted play
- [ ] Mute icon correctly shows unmuted when `activate()` succeeds with unmuted play

## Work Log

### 2026-04-08 - Found during code review

**By:** Claude Code (ce-review)

**Actions:**
- Identified optimistic `setIsMuted(false)` at FeedCard.tsx:153
- Traced flow: synchronous state update → render commit → async play rejection → second state update
- Flagged as Critical by TS reviewer; confirmed interacts with play/pause race (todo 120)

---
