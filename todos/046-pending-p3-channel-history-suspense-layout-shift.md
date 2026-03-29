---
status: complete
priority: p3
issue_id: "046"
tags: [code-review, ux, architecture]
dependencies: []
---

# Channel History Suspense Layout Shift — Skeleton Disappears on Empty Result

## Problem Statement

When `ChannelHistorySection` resolves to `null` (empty channel or API error), the Suspense boundary collapses from full skeleton height to zero, causing a layout shift. The Suspense fallback in `page.tsx` renders a card with a "Channel History" heading and 4 animated skeleton cards. When the promise resolves to `null`, all of this vanishes and the page reflows. This is jarring UX, especially on slow connections where the skeleton is visible for 1-3 seconds.

## Findings

- `src/app/markets/[id]/page.tsx` Suspense fallback: full skeleton card with heading
- `src/components/ChannelHistorySection.tsx`: returns `null` when no videos → entire card disappears on resolve
- Architecture strategist noted this creates a "heading appears then vanishes" effect
- The card container + heading are inside `ChannelHistorySection`, so they appear only in the fallback (via the skeleton), not in the resolved-empty state

## Proposed Solutions

### Solution A: Return an empty-state message instead of `null` (Recommended)
When `fetchChannelRecentVideos` returns `[]`, render the card shell with a short message instead of returning `null`:
```tsx
if (videos.length === 0) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h2 className="text-sm font-medium text-muted mb-3">Channel History</h2>
      <p className="text-sm text-muted">No recent uploads found.</p>
    </div>
  );
}
```
- **Pros**: No layout shift — Suspense resolves to the same card shell; smooth transition
- **Cons**: Shows a card even when the channel has no videos (minor)
- **Effort**: Trivial
- **Risk**: None

### Solution B: Invert responsibility — card shell stays in page.tsx
Move the `bg-card` wrapper and heading out of `ChannelHistorySection` and into `page.tsx` outside the Suspense boundary. `ChannelHistorySection` becomes purely a data fetcher that renders cards or a message.
- **Pros**: Layout stable regardless of outcome; skeleton and resolved state share the container
- **Cons**: Breaks the self-contained component design
- **Effort**: Small
- **Risk**: Low

### Solution C: Accept the layout shift (current behavior)
- **Pros**: No change
- **Cons**: Jarring UX when channel has no recent videos
- **Effort**: None
- **Risk**: None

## Recommended Action

Solution A is the simplest fix with the least structural change. If UX polish is a priority, Solution B is architecturally cleaner.

## Technical Details

- **Affected files**: `src/components/ChannelHistorySection.tsx`

## Acceptance Criteria

- [ ] When `fetchChannelRecentVideos` returns `[]`, the card shell remains visible (no layout shift)
- [ ] When the channel has videos, the card renders with the full scrollable list as before
- [ ] The Suspense skeleton and the resolved state have consistent visual height

## Work Log

- 2026-03-23: Identified by architecture-strategist during code review of feat/video-intelligence-panel
