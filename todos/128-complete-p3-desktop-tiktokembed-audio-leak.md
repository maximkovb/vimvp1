---
status: pending
priority: p3
issue_id: "128"
tags: [desktop, video, audio, tiktokembed, code-review]
dependencies: []
---

# Desktop TikTokEmbed Has No Playback Control — Audio Leaks When Scrolling

On desktop, `activate()`/`deactivate()` operate on a `videoRef` that is `null` in the desktop layout. The TikTok embed may auto-play and continue playing audio as users scroll.

## Problem Statement

`FeedCard.tsx:215-228`: Desktop layout renders `<TikTokEmbed>` inside a div. The `useImperativeHandle` at lines 149-169 operates on `videoRef.current`, which is only wired to the mobile `<video>` element (line 279). In the desktop layout, `videoRef.current` is `null`.

This means:
1. `activate()` returns early: `if (!v) return`
2. `deactivate()` returns early: `if (!v) return`
3. The IntersectionObserver calls these on desktop but they do nothing
4. `TikTokEmbed` has its own internal `videoRef` not exposed via `forwardRef`
5. If `TikTokEmbed` autoplays internally (many TikTok embeds do), audio continues playing on desktop when the user scrolls to the next card

The comment at line 215 acknowledges this: `// TODO(desktop): wire IO control once TikTokEmbed exposes forwardRef`

## Findings

- `FeedCard.tsx:215` — acknowledged TODO for desktop IO wiring
- `FeedCard.tsx:149-169` — `useImperativeHandle` guards on `videoRef.current` which is null on desktop
- `TikTokEmbed` component at `src/components/TikTokEmbed.tsx` — has its own internal video handling
- Performance reviewer flagged: "If TikTokEmbed uses an iframe or a second `<video>` tag internally, those will continue playing audio in the background on desktop"

## Proposed Solutions

### Option 1: Expose a ref from TikTokEmbed via forwardRef (recommended long-term)

**Approach:** Refactor `TikTokEmbed` to accept and forward a ref to its internal `<video>` element. Then wire it to `FeedCard`'s `activate`/`deactivate`.

**Pros:** Full control; consistent behavior across mobile and desktop
**Cons:** Requires TikTokEmbed refactor
**Effort:** Medium
**Risk:** Low

---

### Option 2: Mute/pause via postMessage if TikTokEmbed renders an iframe

**Approach:** If `TikTokEmbed` uses an iframe, post a `pause` command via `postMessage`. This is the standard approach for cross-origin embeds.

**Pros:** Works without refactoring TikTokEmbed internals
**Cons:** Depends on whether the iframe's parent domain listens to postMessage; not reliable for all embed types
**Effort:** Small
**Risk:** Medium

---

### Option 3: Disable desktop autoplay in TikTokEmbed props

**Approach:** Pass an `autoPlay={false}` prop to `TikTokEmbed` so it never autoplays on desktop.

**Pros:** Simple; stops the audio leak
**Cons:** Desktop embed never plays without user interaction
**Effort:** Trivial
**Risk:** Low

---

## Recommended Action

Apply Option 3 short-term to stop audio leaks. Track Option 1 as a follow-up.

## Technical Details

**Affected files:**
- `src/components/FeedCard.tsx:219-226` — TikTokEmbed usage in desktop layout
- `src/components/TikTokEmbed.tsx` — check if it accepts/respects an autoPlay prop

**No database changes needed.**

## Acceptance Criteria

- [ ] On desktop, scrolling away from a card stops any audio from that card's embed
- [ ] Desktop video still plays when user interacts with it directly

## Work Log

### 2026-04-08 - Found during code review

**By:** Claude Code (ce-review)

**Actions:**
- Confirmed desktop layout bypasses `activate()`/`deactivate()` controls via null videoRef
- Performance reviewer flagged as Important desktop audio leak
- Noted existing TODO comment at FeedCard.tsx:215

---
