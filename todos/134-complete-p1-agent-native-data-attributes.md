---
status: pending
priority: p1
issue_id: "134"
tags: [code-review, agent-native, ux]
dependencies: []
---

# Agent-Native: Add Data Attributes for Playback State Visibility

## Problem Statement

The doomscroll feed (`FeedCard` + `DiscoverFeed`) has zero visibility into playback and feed state for agents. When agents interact with the feed:
- They can click play/pause and mute buttons
- But cannot query "is this video muted?" without console access
- Cannot determine which card is currently "active" in the feed
- Cannot read back playback progress

This breaks automated testing, monitoring agents, and any agent-driven feed navigation.

## Findings

**From:** agent-native-reviewer  
**Source:** `/src/components/FeedCard.tsx` (lines 143–148, 312–330), `/src/components/DiscoverFeed.tsx` (lines 145–176)

### Current State
- `isMuted`, `isPaused`, `progress` are React state only
- `activeIdx` stored in `useRef`, not reflected in DOM
- Video element has no data attributes

### Required Changes
1. Add `data-is-muted={isMuted}` to `<video>` element
2. Add `data-is-paused={isPaused}` to `<video>` element
3. Add `data-progress={Math.round(progress * 100)}` to `<video>` element
4. Add `data-active={index === activeIdx}` to active FeedCard wrapper in DiscoverFeed

## Proposed Solutions

### Solution 1: Add Data Attributes (Recommended)
**Approach:** Mirror React state to DOM via `data-*` attributes. Zero performance impact, backward-compatible.

**Pros:**
- Non-invasive, purely data-layer
- Agents can query via `document.querySelector('[data-is-muted="true"]')`
- No component refactoring needed
- Enables automated testing immediately

**Cons:**
- Adds 4 attributes per video element
- Requires updating multiple files

**Effort:** SMALL (5–10 minutes)

**Risk:** NONE

---

### Solution 2: Expose Ref-Based State API
**Approach:** Wrap FeedCard ref to expose `{ isMuted(), isPaused(), progress() }` getters.

**Pros:**
- Explicit API, type-safe

**Cons:**
- Requires ref consumer code changes
- More complex than data attributes
- Agents still need to know about the API

**Effort:** MEDIUM (30 minutes)

**Risk:** Could break existing ref consumers if interface changes

---

## Recommended Action

**Implement Solution 1** — Add data attributes. This is the standard agent-native pattern for DOM visibility.

## Acceptance Criteria

- [ ] `<video>` element in FeedCard includes `data-is-muted`, `data-is-paused`, `data-progress`
- [ ] Active FeedCard wrapper includes `data-active` attribute
- [ ] Attributes update in real-time as state changes (video.setAttribute() on each state update)
- [ ] Agents can query `document.querySelector('video[data-is-muted="false"]')` and get correct result
- [ ] Agent can click mute button, read `data-is-muted`, see it change to `true`
- [ ] Agent can read `data-progress` and see it increment as video plays

## Technical Details

**Files to modify:**
1. `src/components/FeedCard.tsx` (lines 312–330: video element)
2. `src/components/DiscoverFeed.tsx` (lines 145–176: active FeedCard wrapper)

**Implementation sketch:**
```tsx
// FeedCard.tsx, around line 312
<video
  ref={videoRef}
  key={currentPlayUrl}
  src={currentPlayUrl}
  poster={thumbnailSrc ?? undefined}
  muted={isMuted}
  loop
  playsInline
  preload={priority ? "metadata" : "none"}
  className="absolute inset-0 w-full h-full object-cover"
  data-is-muted={isMuted}        // ADD
  data-is-paused={isPaused}      // ADD
  data-progress={Math.round(progress * 100)}  // ADD
  onClick={(e) => { e.stopPropagation(); togglePause(); }}
  onError={handleVideoError}
  onTimeUpdate={(e) => {
    const v = e.currentTarget;
    if (v.duration > 0) setProgress(v.currentTime / v.duration);
  }}
  onPause={() => setIsPaused(true)}
  onPlay={() => setIsPaused(false)}
/>

// DiscoverFeed.tsx, around line 157
<div 
  key={market.id} 
  className="snap-start h-screen" 
  data-card-index={index}
  data-active={index === activeIdxRef.current}  // ADD
>
```

## Work Log

- **2026-04-12 00:00** — Created todo from agent-native-reviewer findings
- **Status:** Waiting for implementation

## Resources

- **Agent-Native Review:** `agent-native-reviewer` findings (PR review session 2026-04-11)
- **Related:** Agent-native parity guide — data attributes are the standard pattern for state visibility
