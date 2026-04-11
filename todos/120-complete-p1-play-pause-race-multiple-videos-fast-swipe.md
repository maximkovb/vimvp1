---
status: pending
priority: p1
issue_id: "120"
tags: [video, playback, feed, race-condition, audio, code-review]
dependencies: []
---

# Fix Play/Pause Race — Two Videos Play Simultaneously on Fast Swipe

Prevent two videos from playing at the same time when the user swipes quickly through the feed.

## Problem Statement

`FeedCard.activate()` calls `v.play()` which returns a Promise. If the user swipes past two cards quickly, the IntersectionObserver calls `deactivate()` on card A (which calls `v.pause()`) while card A's `v.play()` Promise is still pending. The `pause()` call races the pending `play()` — if `play()` resolves *after* `pause()` executes, card A resumes playing. Card B is also playing. Result: two videos with audio simultaneously, which is the most user-visible playback bug in the feed.

## Findings

- `FeedCard.tsx:155-159` — `v.play()` returns an untracked Promise; `deactivate()` at lines 162-168 calls `v.pause()` without waiting for any pending play
- `FeedCard.tsx:202-209` — `togglePause` similarly calls `v.play()` with a `.catch(() => {})` that doesn't guard against a pending deactivation
- Browser spec: calling `v.pause()` before a pending `v.play()` promise resolves causes the `play()` promise to reject with `AbortError` — but the resolution order is implementation-defined, and on Chrome/iOS it frequently resolves AFTER the pause
- Performance reviewer confirmed: on any mid-range Android this is reproducible on fast swipe

## Proposed Solutions

### Option 1: Track the play Promise and await it before pausing (recommended)

**Approach:** Add a `playPromiseRef` inside the `useImperativeHandle` closure. `activate()` stores the play promise; `deactivate()` awaits any pending promise before calling `pause()`.

```ts
const playPromiseRef = useRef<Promise<void> | null>(null);

useImperativeHandle(ref, () => ({
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
  deactivate() {
    const v = videoRef.current;
    if (!v) return;
    const doStop = () => {
      v.pause();
      v.muted = true;
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
}));
```

**Pros:** Correct per the HTML spec; eliminates the race entirely
**Cons:** Deactivation is now async — brief delay (~1 frame) before pause takes effect
**Effort:** Small
**Risk:** Low

---

### Option 2: Set `v.currentTime = 0` and rely on `preload="none"` to avoid the race

**Approach:** Instead of tracking the promise, call `v.load()` in `deactivate()` to abort any pending play.

**Pros:** Simple one-liner
**Cons:** Resets the video to beginning; doesn't allow resume from current position; causes a re-fetch of the video

**Effort:** Trivial
**Risk:** Medium (UX regression — users can't resume from where they left off)

---

## Recommended Action

Apply Option 1. Also combine with setting `isMuted` only after `play()` resolves (see todo 121) since both changes touch the same code block.

## Technical Details

**Affected files:**
- `src/components/FeedCard.tsx:149-168` — `useImperativeHandle` block for `activate`/`deactivate`

**No database changes needed.**

## Acceptance Criteria

- [ ] Swiping past 3+ cards rapidly never results in two videos playing simultaneously
- [ ] Audio from the previous card stops before the next card's audio starts
- [ ] Pause/play state is correct after a fast swipe sequence
- [ ] `activate()` still attempts unmuted play with muted fallback

## Work Log

### 2026-04-08 - Found during code review

**By:** Claude Code (ce-review)

**Actions:**
- Identified untracked `v.play()` Promise in `activate()` at FeedCard.tsx:155
- Traced the race: `play()` pending → `deactivate()` calls `pause()` → `play()` resolves and overrides pause
- Confirmed as the most user-visible playback bug per performance review agent

---
