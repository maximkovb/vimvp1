---
status: pending
priority: p1
issue_id: "121"
tags: [video, audio, mute, react, code-review]
dependencies: []
---

# Hardcoded `muted` Attribute Causes Silent Re-Mute After Video URL Refresh

When a TikTok CDN URL expires and `handleVideoError` fetches a new one, the `<video>` element remounts with `muted` hardcoded in JSX. Any previously unmuted state is permanently lost without `activate()` being called again.

## Problem Statement

`FeedCard.tsx:283` renders `<video muted ...>` — the `muted` attribute is always present regardless of `isMuted` state. When `handleVideoError` updates `currentPlayUrl`, React sees `key={currentPlayUrl}` change and unmounts/remounts the `<video>` element. The fresh element parses `muted` from the JSX attribute and sets `HTMLMediaElement.muted = true`.

`activate()` is **not** called again after a URL refresh (no IntersectionObserver intersection event fires). So the video remounts: muted, not playing, and `isPaused` is still `false` — the play icon is hidden but the video is frozen and silent.

Additionally, if the user had successfully unmuted (via `activate()` succeeding or via `toggleMute()`), the `isMuted` React state is `false` while the DOM attribute forces muted. The UI shows the unmuted icon while audio is silenced — a split-brain state.

## Findings

- `FeedCard.tsx:283` — `<video ... muted loop ...>` — hardcoded boolean attribute
- `FeedCard.tsx:177-193` — `handleVideoError()` sets `currentPlayUrl` → triggers `key` change → full video remount
- After remount: `videoRef.current.muted === true` (DOM) vs `isMuted === false` (React state) if user had unmuted
- `activate()` is never called post-remount; only `handleVideoError` is triggered by `onError`
- React known limitation: the `muted` attribute is a parsed HTML attribute, not a DOM property React can update reflectively. The only safe way to sync it post-mount is imperative `videoRef.current.muted = value`.

## Proposed Solutions

### Option 1: Change `muted` to `muted={isMuted}` + re-call activate logic on URL change (recommended)

**Approach:**

1. Change line 283: `muted={isMuted}` instead of hardcoded `muted`
2. In `handleVideoError`, after setting the new URL, set a flag so that when the new video element mounts, it re-runs the activate logic. Track "is this card currently active" with a ref.

```tsx
const isActiveRef = useRef(false);

// in useImperativeHandle:
activate() {
  isActiveRef.current = true;
  // ... existing logic
},
deactivate() {
  isActiveRef.current = false;
  // ... existing logic
},

// in handleVideoError, after setCurrentPlayUrl:
if (isActiveRef.current) {
  // New video will mount; activate once it's ready
  // Use onCanPlay or onLoadedMetadata on the video to trigger playback
}
```

3. Add `onCanPlay` handler to the `<video>` that calls the activate logic if `isActiveRef.current`:
```tsx
onCanPlay={() => {
  if (isActiveRef.current && videoRef.current) {
    videoRef.current.muted = false;
    videoRef.current.play().catch(() => {
      if (videoRef.current) videoRef.current.muted = true;
    });
  }
}}
```

**Pros:** Correct behavior — URL refresh seamlessly resumes unmuted playback
**Cons:** Slightly more complex; `onCanPlay` can fire multiple times (guard with a ref)
**Effort:** Small-Medium
**Risk:** Low

---

### Option 2: Sync `isMuted` to `true` in `handleVideoError` before setting URL

**Approach:** In `handleVideoError`, call `setIsMuted(true)` before `setCurrentPlayUrl(...)`. This makes the UI and DOM consistent (both muted) after remount. User must re-tap unmute.

**Pros:** Simple; no state split-brain
**Cons:** Resets user's mute preference on every error; poor UX if errors are frequent
**Effort:** Trivial
**Risk:** Low

---

## Recommended Action

Apply Option 2 immediately to stop the split-brain state. File a follow-up for Option 1's `onCanPlay` flow to restore seamless resume.

## Technical Details

**Affected files:**
- `src/components/FeedCard.tsx:283` — `muted` attribute
- `src/components/FeedCard.tsx:177-193` — `handleVideoError`
- `src/components/FeedCard.tsx:149-169` — `useImperativeHandle`

**No database changes needed.**

## Acceptance Criteria

- [ ] After `handleVideoError` fetches a new URL, `isMuted` React state matches the DOM `video.muted` property
- [ ] The mute/unmute icon always reflects actual audio state
- [ ] No silent-but-shows-unmuted scenario

## Work Log

### 2026-04-08 - Found during code review

**By:** Claude Code (ce-review)

**Actions:**
- Identified hardcoded `muted` attribute at FeedCard.tsx:283
- Traced flow: `onError` → `handleVideoError` → `setCurrentPlayUrl` → `key` change → remount with `muted` attribute
- Confirmed `activate()` is not called again post-remount (no IO intersection event)
- TS reviewer confirmed this as Critical; learnings researcher confirmed never toggle `muted` via React prop

---
