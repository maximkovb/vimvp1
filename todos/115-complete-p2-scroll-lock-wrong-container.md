---
status: pending
priority: p2
issue_id: "115"
tags: [code-review, bug, mobile]
dependencies: [110]
---

# Body scroll lock targets wrong element — iOS Safari still scrolls feed behind sheet

## Problem Statement

`BetSheet` sets `document.body.style.overflow = "hidden"` to prevent the feed from scrolling while the sheet is open. On iOS Safari, this does not work when the scrollable element is a child `div` (not the `body`). The feed column uses `overflow-y-scroll` on its own container div — iOS Safari ignores the `body` lock in this case, allowing the user to scroll to a different market while the sheet is open.

## Findings

- `src/components/BetSheet.tsx:57-66`: `document.body.style.overflow = "hidden"` — targets body, not the scroll container
- `src/components/DiscoverFeed.tsx:99-103`: the actual scrollable element is `<div ref={feedColumnRef} className="h-screen overflow-y-scroll snap-y snap-mandatory">`
- Security agent (Finding 5): "iOS Safari ignores `overflow: hidden` on `body` when the scrollable element is not the body itself"
- Performance agent: "Setting `document.body.style.overflow = "hidden"` triggers a synchronous style recalculation and potentially a layout pass on the body and all its children. With 50 full-viewport divs in the feed, this is expensive."
- `feedColumnRef` is already passed to `BetSheet` as `containerRef` — the ref to the correct element is available

## Proposed Solutions

### Option 1: Target the feed container ref instead of body

**Approach:**

```ts
// BetSheet.tsx
useEffect(() => {
  const el = containerRef?.current;
  if (!el) return;
  if (open) {
    el.style.overflow = "hidden";
  } else {
    el.style.overflow = "";
  }
  return () => {
    if (el) el.style.overflow = "";
  };
}, [open, containerRef]);
```

**Pros:** Correct behavior on iOS Safari; scopes mutation to one element; avoids global body layout thrash
**Cons:** If `containerRef` is removed (see todo #110), this needs to move to `DiscoverFeed`

**Effort:** 10 minutes
**Risk:** Low

## Recommended Action

Target `containerRef.current` (the feed div). Coordinate with todo #110 (vaul portal scoping) since that todo may move the scroll lock responsibility to `DiscoverFeed`.

## Technical Details

**Affected files:**
- `src/components/BetSheet.tsx:57-66`

**Related:** todo #110 (vaul portal container)

## Acceptance Criteria

- [ ] Feed does not scroll while the bet sheet is open on iOS Safari
- [ ] Scroll snap position is preserved when the sheet is closed

## Work Log

### 2026-04-05 - Found in code review

**By:** Claude Code (security-sentinel + performance-oracle agents)
