---
status: pending
priority: p2
issue_id: "110"
tags: [code-review, architecture, accessibility, mobile]
dependencies: []
---

# Remove vaul portal container scoping — breaks Safari fixed positioning and ARIA

## Problem Statement

`BetSheet` passes `containerRef.current` (the snap-scroll `div`) as the `container` prop to both `Drawer.Root` and `Drawer.Portal`. This means vaul's overlay and drawer content render as children of the scroll container rather than `document.body`. This breaks `position: fixed` semantics in Safari (overflow:scroll creates a containing block, clipping fixed children), defeats the focus trap, and makes `aria-modal` semantically incorrect.

## Findings

- `src/components/BetSheet.tsx:83-88`: `container={containerRef?.current ?? undefined}` on both `Drawer.Root` and `Drawer.Portal`
- Architecture agent: "A parent with `overflow: hidden` or `overflow: scroll` creates a new containing block in some browsers, making `fixed inset-0` cover only the scroll container, not the viewport"
- Security agent (Finding 6): `containerRef.current` is `null` on initial render — portal falls back to `document.body` on first open, then silently changes container on subsequent renders if the component re-renders
- WCAG 2.1 criterion 2.1.1: focus trap requires the modal overlay to cover the entire application, not just the scroll container
- vaul is designed to portal to `document.body` by default; `container` is an escape hatch for embedding in iframes, not for scroll containers

## Proposed Solutions

### Option 1: Remove `container` prop from Drawer.Root and Drawer.Portal

**Approach:** Let vaul use its default portal target (`document.body`). Fix background scroll prevention separately.

```tsx
<Drawer.Root open={open} onOpenChange={onOpenChange}>
  <Drawer.Portal>  {/* no container prop */}
    ...
```

For scroll lock, target the feed container ref instead of body (see todo #115).

**Pros:** Correct `position: fixed` semantics on all browsers; proper focus trap; correct ARIA; eliminates the null-ref race condition
**Cons:** Sheet no longer visually contained within the feed column on desktop — covers full viewport (which is correct behavior for a modal sheet)

**Effort:** 20 minutes (remove prop + fix scroll lock)
**Risk:** Low

## Recommended Action

Remove both `container` props. Handle scroll lock via the feed container ref (todo #115).

## Technical Details

**Affected files:**
- `src/components/BetSheet.tsx:83-88` — remove `container` from Drawer.Root and Drawer.Portal

**Related:** todo #115 (body scroll lock targets wrong element)

## Acceptance Criteria

- [ ] BetSheet overlay covers full viewport on mobile
- [ ] Focus is trapped inside the sheet on keyboard navigation
- [ ] Safari: sheet is not clipped by the scroll container
- [ ] No regression: sheet still opens and closes correctly

## Work Log

### 2026-04-05 - Found in code review

**By:** Claude Code (architecture-strategist + security-sentinel agents)
