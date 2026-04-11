---
status: pending
priority: p2
issue_id: "126"
tags: [performance, memory, video, code-review]
dependencies: []
---

# Video Element Not Cleaned Up on Unmount — Media Pipeline Memory Leak

`FeedCard` does not release the browser media pipeline when unmounted. Long sessions accumulate decoded video buffers from every card ever rendered.

## Problem Statement

`<video>` elements hold a decoded media pipeline (demuxer, decoder, frame buffers) that browsers do not release until both the `src` attribute is cleared AND `v.load()` is called. React unmounting the component removes the element from the DOM but does not explicitly tear down the pipeline.

On a TikTok-style feed where the server might render 10-20 cards at a time (or more with pagination), each unmounted card leaves behind its media pipeline. On mobile devices with 2-4 GB RAM this accumulates noticeably in long sessions.

The issue is amplified by `handleVideoError` (FeedCard.tsx:177-193): when it fetches a new URL and updates `currentPlayUrl`, the `key={currentPlayUrl}` prop causes React to unmount the old `<video>` element and mount a new one — without cleaning up the old pipeline.

## Findings

- `FeedCard.tsx:278-292` — `<video>` element rendered with no corresponding `useEffect` cleanup
- `FeedCard.tsx:177-193` — `handleVideoError` triggers `key` change → old `<video>` unmounted without pipeline teardown
- Performance reviewer confirmed: "browsers do not release until both `src` is cleared AND `v.load()` is called"
- No `useEffect` return cleanup exists anywhere in FeedCard

## Proposed Solutions

### Option 1: Add `useEffect` cleanup to release media pipeline (recommended)

**Approach:**

```tsx
useEffect(() => {
  return () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.removeAttribute("src");
    v.load(); // forces browser to release demuxer, decoder, frame buffers
  };
}, []); // runs once on unmount
```

**Pros:** Standard pattern; confirmed by MDN to release all media resources; zero functional impact during normal operation
**Cons:** None
**Effort:** Trivial (5 min)
**Risk:** Low

---

### Option 2: Use `key` on the entire FeedCard instead of just the video

Not applicable — `key` at the FeedCard level would remount the entire card, losing all state. Option 1 is the right approach.

---

## Recommended Action

Apply Option 1 immediately.

## Technical Details

**Affected files:**
- `src/components/FeedCard.tsx` — add one `useEffect` with cleanup

**No database changes needed.**

## Acceptance Criteria

- [ ] On FeedCard unmount, `video.src` is removed and `video.load()` is called
- [ ] No visible regression in playback behavior
- [ ] Memory profile in DevTools shows media pipeline releases after scrolling through 10+ cards

## Work Log

### 2026-04-08 - Found during code review

**By:** Claude Code (ce-review)

**Actions:**
- Identified missing cleanup in FeedCard
- Performance reviewer confirmed this as Critical for long sessions
- Standard fix: useEffect return with `removeAttribute("src")` + `load()`

---
