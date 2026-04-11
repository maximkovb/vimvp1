---
status: pending
priority: p2
issue_id: "127"
tags: [performance, video, network, mobile, code-review]
dependencies: []
---

# `preload="metadata"` on All Cards Fires Parallel Range Requests for Every Video

Every card in the feed immediately fetches 256KB–2MB of video data on page load, saturating mobile network bandwidth before the user has scrolled.

## Problem Statement

`FeedCard.tsx:285`: `<video ... preload="metadata" ...>`

`preload="metadata"` instructs the browser to fetch enough of the video to determine duration, dimensions, and the first frame. For CDN-hosted MP4s, this typically triggers 256KB–2MB range requests. These requests fire **in parallel for every card rendered in the DOM** at page load time.

On a feed of 10 cards:
- ~10 simultaneous media range requests on page load
- Saturates mobile radio (LTE/5G share bandwidth across requests)
- Delays the first card's playback start — the card the user actually wants to see
- Drains battery before any interaction

The `priority` prop (FeedCard.tsx:33) already marks the first two cards as priority. The intent is there; it just isn't applied to the `preload` attribute.

## Findings

- `FeedCard.tsx:285` — `preload="metadata"` hardcoded for all cards regardless of `priority` prop
- `FeedCardProps` at line 33 — `priority?: boolean` already indicates which cards are above the fold
- `DiscoverFeed.tsx:174` — `priority={index < 2}` — first two cards are priority
- Performance reviewer confirmed: O(n) network requests on load; worst case 30 cards × 2MB = 60MB fetched before scroll

## Proposed Solutions

### Option 1: Set `preload="none"` for non-priority cards (recommended)

**Approach:**

```tsx
preload={priority ? "metadata" : "none"}
```

Priority cards (first 2) preload metadata. All others use `"none"` — browser fetches nothing until the user scrolls near them. The IntersectionObserver's `activate()` calling `v.play()` will trigger the fetch at the right time.

**Pros:** Minimal change; immediate bandwidth reduction; first card loads faster
**Cons:** Non-priority cards may have a slightly longer time-to-play when scrolled to (browser starts fetch on IO trigger)
**Effort:** Trivial (one line)
**Risk:** Low

---

### Option 2: `preload="none"` for all cards, rely on IO to trigger fetches

**Approach:** Remove `preload="metadata"` entirely from all cards.

**Pros:** Maximum bandwidth savings at load
**Cons:** Even the first card has no preloaded metadata; may cause a brief blank before first frame shows
**Effort:** Trivial
**Risk:** Low-Medium (first card UX slightly worse)

---

## Recommended Action

Apply Option 1: `preload={priority ? "metadata" : "none"}`.

## Technical Details

**Affected files:**
- `src/components/FeedCard.tsx:285` — change `preload="metadata"` to `preload={priority ? "metadata" : "none"}`

**No database changes needed.**

## Acceptance Criteria

- [ ] Non-priority cards (index ≥ 2) render with `preload="none"` in the DOM
- [ ] Priority cards (index 0, 1) still use `preload="metadata"`
- [ ] Network DevTools shows no media range requests for off-screen cards on page load
- [ ] First card still plays without noticeable delay

## Work Log

### 2026-04-08 - Found during code review

**By:** Claude Code (ce-review)

**Actions:**
- Identified `preload="metadata"` hardcoded on all cards
- Performance reviewer flagged as Important; confirmed `priority` prop is already available
- One-line fix: `preload={priority ? "metadata" : "none"}`

---
