---
status: complete
priority: p1
issue_id: "054"
tags: [code-review, architecture, ux, market-creation]
---

# Anchor set to unclamped AI value — proportional controls broken for viral videos

## Problem Statement

`setAnchorMilestone(result.contract.milestoneThreshold)` stores the raw AI recommendation as the anchor, but `setMilestoneThreshold(String(clampedMilestone))` stores a value that may be significantly higher (clamped to `ceil(viewCount × 1.2)`). The anchor is the denominator in both proportional handlers. When `clampedMilestone > anchorMilestone`, the ratio `value / anchorMilestone` starts above 1.0, causing the resolution window to immediately snap to 168h on the first slider touch — even if the admin intended 72h. The bidirectional proportional coupling (the feature's core UX) is broken for any video where the AI recommendation falls below the 20% floor.

## Findings

- **File:** `src/app/admin/markets/new/page.tsx` — lines 141–148
- `setAnchorMilestone(result.contract.milestoneThreshold)` — raw AI value (may be below floor)
- `setMilestoneThreshold(String(clampedMilestone))` — clamped value (may be above anchor)
- `handleMilestoneSlider`: `snapToPreset(anchorHours * (value / anchorMilestone))` — ratio >1 from first touch → 168h
- `handleResolutionButton`: `Math.round(anchorMilestone * (hours / anchorHours))` → projects milestone below floor → silently re-clamped by `Math.max(milestoneMin, ...)`, so two handlers are no longer inverses
- Identified by: architecture-strategist (High severity)

## Proposed Solutions

### Option A: Set anchor to clamped milestone (Recommended)

```ts
// In handleFetchVideo, after computing clampedMilestone:
setMilestoneThreshold(String(clampedMilestone));
setAnchorMilestone(clampedMilestone);  // ← was result.contract.milestoneThreshold
```

If the raw AI recommendation is needed for display (e.g., a "AI suggested X" label), add a separate `aiRecommendedMilestone` read-only state. This is a 1-line fix that restores the proportional coupling invariant.

**Pros:** Correct — anchor represents "starting point for proportional math," not "raw AI value." Minimal change.
**Cons:** Anchor and AI recommendation diverge; must document the distinction.
**Effort:** Small

### Option B: Recompute proportional ratio from clamped value

Keep `anchorMilestone` as the AI value but recompute the proportional ratio using `max(currentSliderValue, milestoneFloor)` as the effective reference. Complex and fragile.

**Pros:** Preserves the AI recommendation as anchor.
**Cons:** Much more complex; hides the root cause.
**Effort:** Large

## Acceptance Criteria

- [ ] For a viral video where `viewCount × 1.2 > contract.milestoneThreshold`, dragging the slider does not immediately snap resolution to 168h
- [ ] Clicking a resolution preset correctly recalculates the milestone proportionally without re-clamping
- [ ] The bidirectional coupling is symmetric: `slider → resolution → slider` returns to approximately the original value
- [ ] Existing unit tests in `helpers.test.ts` continue to pass

## Work Log

- 2026-03-24: Found by architecture-strategist during code review of commit cac047a

## Resources

- PR commit: `cac047a` — feat(market-creation): enforce 20% milestone floor above current analytics
- File: `src/app/admin/markets/new/page.tsx:141–148`
- Architecture review: anchor-vs-clamped divergence finding
