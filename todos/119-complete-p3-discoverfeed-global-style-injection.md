---
status: pending
priority: p3
issue_id: "119"
tags: [code-review, quality, css]
dependencies: []
---

# Move global scrollbar style out of DiscoverFeed JSX

## Problem Statement

`DiscoverFeed` injects a `<style>` tag into the DOM that affects ALL `div` elements on the page:

```tsx
<style>{`div::-webkit-scrollbar { display: none; }`}</style>
```

This is an unscoped global side effect embedded inside a component. It will suppress scrollbars on every `div` anywhere in the app, not just the feed container. It also re-injects the style tag on every render.

## Findings

- `src/components/DiscoverFeed.tsx:103`: inline `<style>` tag
- Simplicity agent: "affects all `div` elements globally, not scoped to the feed container... a side-effect-leaking component"
- Should be in `src/app/globals.css` with a specific selector if it needs to be global, or use `scrollbar-width: none` + the webkit vendor prefix on the specific container's class

## Proposed Solutions

### Option 1: Move to globals.css with a scoped class

```css
/* globals.css */
.hide-scrollbar {
  scrollbar-width: none;
}
.hide-scrollbar::-webkit-scrollbar {
  display: none;
}
```

Then add `hide-scrollbar` to the feed container's className.

**Effort:** 10 minutes
**Risk:** None

## Acceptance Criteria

- [ ] No `<style>` tag in `DiscoverFeed` JSX
- [ ] Feed scrollbar still hidden
- [ ] Other div elements unaffected

## Work Log

### 2026-04-05 - Found in code review

**By:** Claude Code (code-simplicity-reviewer agent)
