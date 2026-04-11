---
status: pending
priority: p2
issue_id: "124"
tags: [video, state, ui, code-review]
dependencies: []
---

# `isPaused` Initializes to `false` While Video Is Not Yet Playing

Before `activate()` is called for the first time, the video is paused at the browser level but React state says `isPaused = false`. The play icon never appears on the first load, giving the impression the video is playing when it isn't.

## Problem Statement

`FeedCard.tsx:145`: `const [isPaused, setIsPaused] = useState(false)`

A `<video>` element with `preload="metadata"` does not autoplay on mount — playback only begins when `activate()` calls `v.play()`. Before the IntersectionObserver fires `activate()`, the video is paused at the DOM level while React state says it is not paused (`isPaused = false`). The play icon is therefore hidden, suggesting the video is playing when it isn't.

This is most visible on initial page load, before any scroll occurs: the first card is visible in the viewport but the IntersectionObserver may not have fired yet (or may fire slightly after paint). The user sees a static frame with no play icon.

Additionally, when `deactivate()` is called, `v.pause()` fires the `onPause` event which sets `isPaused(true)`. The old (scrolled-away) card briefly shows a play icon as it animates out. Starting with `isPaused = true` makes the initial state consistent.

## Findings

- `FeedCard.tsx:145` — `const [isPaused, setIsPaused] = useState(false)` — incorrect initial value
- `FeedCard.tsx:290-297` — `isPaused && <PlayIcon>` overlay — hidden on first load incorrectly
- `FeedCard.tsx:162-168` — `deactivate()` calls `v.pause()` → `onPause` → `setIsPaused(true)` — correct, but inconsistent with initial state
- TS reviewer flagged: "The correct initial state is `true` (paused until explicitly activated)"

## Proposed Solutions

### Option 1: Initialize `isPaused` to `true` (recommended)

**Approach:** Change line 145 to `const [isPaused, setIsPaused] = useState(true)`.

This makes the initial state consistent: the video is paused on mount, so `isPaused = true` is correct. The play icon shows immediately, which is honest about the video not yet playing. `activate()` calls `v.play()` → `onPlay` fires → `setIsPaused(false)` removes the icon.

**Pros:** Consistent initial state; no false "playing" signal; one-character change
**Cons:** Play icon appears briefly on mount before IO fires (~16-50ms). On cards below the fold this is invisible. On the first card this is visible but expected (video isn't playing yet).
**Effort:** Trivial
**Risk:** Low

---

### Option 2: Derive `isPaused` from a `useEffect` that checks `videoRef.current.paused`

**Approach:** Instead of state, use an effect to sync with the DOM after mount.

**Pros:** Always accurate
**Cons:** Effect runs after paint — there's still a brief window of incorrect state; adds complexity for marginal gain
**Effort:** Small
**Risk:** Low

---

## Recommended Action

Apply Option 1. Also add `setIsPaused(false)` explicitly inside `activate()` alongside the `onPlay` event handler (belt-and-suspenders), and `setIsPaused(true)` explicitly inside `deactivate()`.

## Technical Details

**Affected files:**
- `src/components/FeedCard.tsx:145` — change `useState(false)` to `useState(true)`
- `src/components/FeedCard.tsx:162-168` — add `setIsPaused(true)` to `deactivate()`

**No database changes needed.**

## Acceptance Criteria

- [ ] On initial page load, the first card shows the play icon (video not yet playing)
- [ ] After `activate()` fires and `v.play()` resolves, the play icon disappears
- [ ] After `deactivate()`, the play icon appears immediately (not relying on async `onPause` event)
- [ ] `togglePause()` still correctly toggles the play icon via `onPause`/`onPlay` events

## Work Log

### 2026-04-08 - Found during code review

**By:** Claude Code (ce-review)

**Actions:**
- Identified `isPaused = false` initial state as inconsistent with video not playing on mount
- TS reviewer flagged as Critical; agreed initial state should be `true`
- Also noted `deactivate()` doesn't call `setIsPaused(true)` directly (see companion fix below)

---
