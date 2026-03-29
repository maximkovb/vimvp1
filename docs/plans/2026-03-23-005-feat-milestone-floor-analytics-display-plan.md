---
title: "feat: Milestone 20% Floor & Current Analytics Display"
type: feat
status: completed
date: 2026-03-23
origin: docs/brainstorms/2026-03-23-market-creation-proportional-controls-requirements.md
---

# feat: Milestone 20% Floor & Current Analytics Display

## Overview

The milestone slider in the market creation form currently allows the admin to drag the target as low as 10% of the AI anchor — which can be below the video's current view/like count. Two changes address this: (1) enforce a minimum of 20% above the video's current analytics, and (2) display that current count near the slider so the admin can see the floor in context.

## Problem Statement / Motivation

A milestone target below (or barely above) what a video has already achieved is meaningless — the market would resolve YES immediately or within hours of creation. The 20% floor guarantees that every market requires measurable future growth to resolve. Without a visible reference count, the floor is invisible to the admin and the constraint appears arbitrary.

## Proposed Solution

Replace the static `milestoneMin = anchorMilestone * 0.1` with:

```
milestoneFloor = Math.max(
  Math.round(anchorMilestone * 0.1),
  Math.ceil(currentAnalytics * 1.20)
)
```

Where `currentAnalytics` is `videoPreview.viewCount` or `videoPreview.likeCount` depending on the active `questionType`.

Apply this floor consistently across four sites in `page.tsx`:
1. The slider `min` attribute
2. The initial `milestoneThreshold` state assignment after fetch (clamp to floor)
3. The `handleResolutionButton` clamp (currently uses `milestoneMin`)
4. A `useEffect` that re-clamps when `questionType` changes

Also raise `milestoneMax` dynamically when the floor would otherwise exceed the ceiling (see Gap C1 below).

Add a "Current: X" label beneath the slider track, formatted with `formatCount` and the active metric unit.

## Technical Considerations

### Effective floor derivation (single source of truth)

Derive `milestoneFloor` inline alongside the existing `milestoneMin`/`milestoneMax` derivations in `page.tsx` (lines 77–79). Because `currentAnalytics` depends on `questionType`, this value must be re-derived any time either `videoPreview` or `questionType` changes.

```ts
// page.tsx — replace the existing milestoneMin line
const currentAnalytics =
  questionType === "views"
    ? (videoPreview?.viewCount ?? 0)
    : (videoPreview?.likeCount ?? 0);

const milestoneFloor = anchorMilestone
  ? Math.max(
      Math.round(anchorMilestone * 0.1),
      Math.ceil(currentAnalytics * 1.2)
    )
  : 0;

const milestoneMin = milestoneFloor;
const milestoneMax = anchorMilestone
  ? Math.max(anchorMilestone * 5, Math.ceil(currentAnalytics * 1.5))
  : 0;
const milestoneStep = computeStep(Math.max(milestoneFloor, anchorMilestone ?? 0));
```

### Gap C1: Floor can exceed the 5× ceiling

When a video already has more views than 5× the AI anchor (e.g., an already-viral video where the AI underestimated), `milestoneMin > milestoneMax`. The fix: raise `milestoneMax` to `max(5 × anchor, currentAnalytics × 1.50)`. This guarantees at least 25% headroom above the floor before the ceiling.

(see origin: docs/brainstorms/2026-03-23-market-creation-proportional-controls-requirements.md — R6)

### Gap C2 + I2: Clamp on questionType change

When the admin switches `questionType` from "views" to "likes" (or back) after setting the slider, the current milestone value may fall below the new floor. A `useEffect` must re-clamp:

```ts
useEffect(() => {
  if (!anchorMilestone || !milestoneThreshold) return;
  const val = Number(milestoneThreshold);
  if (val < milestoneFloor) {
    setMilestoneThreshold(String(milestoneFloor));
  }
}, [questionType, milestoneFloor]);
```

The `handleResolutionButton` handler (line 164) already clamps to `milestoneMin`. Since `milestoneMin` now equals `milestoneFloor`, it will automatically respect the 20% floor with no changes needed there.

### Gap C3: Initial state after fetch

`handleFetchVideo` sets `milestoneThreshold` to `anchorMilestone` (line 116). If `anchorMilestone < currentAnalytics × 1.20`, the initial value is below the floor. Clamp inline:

```ts
setMilestoneThreshold(
  String(Math.max(Math.round(anchorMilestone), effectiveFloor))
);
```

Where `effectiveFloor` is computed at fetch time using `viewCount` (since `questionType` always resets to `"views"` at the start of each fetch — line 98).

### Gap I4: Step size calibrated to effective range

`computeStep` is currently called with `anchorMilestone`. When the floor is much larger than the anchor, the step becomes too fine for the actual slider range. Call `computeStep(Math.max(milestoneFloor, anchorMilestone))` instead so the step magnitude tracks the lower bound of the actual usable range.

### R10: "Current:" label

Add a `text-xs text-muted` line beneath the slider track (inside the existing right-column `div`):

```tsx
{videoPreview && contractLoaded && (
  <p className="text-xs text-muted">
    Current: {formatCount(currentAnalytics)}{" "}
    {questionType === "views" ? "views" : "likes"}
  </p>
)}
```

Use `formatCount` from `src/lib/format.ts` (outputs uppercase K, e.g. "84.2K") — consistent with the house format already used in the video preview card.

### Server-side validation guard

`createMarket` (admin.ts) does not enforce the 20% floor. The client enforces it visually, but a direct `FormData` POST can bypass it. Add a floor check in `createMarket` using the `initialViewCount` / `initialLikeCount` hidden inputs already in the payload:

```ts
const initialCount =
  questionType === "views" ? initialViewCount : initialLikeCount;
const requiredFloor = Math.ceil(initialCount * 1.2);
if (milestoneThreshold < requiredFloor) {
  return { error: `Milestone must be at least 20% above the current ${questionType} count (${requiredFloor.toLocaleString()})` };
}
```

## Acceptance Criteria

- [ ] **R6**: `milestoneMin` equals `max(0.1× anchor, ceil(currentAnalytics × 1.20))`, never the lower value alone
- [ ] **C1**: `milestoneMax` is raised to `max(5× anchor, ceil(currentAnalytics × 1.50))` when needed; slider `min < max` is always true
- [ ] **C2**: Switching `questionType` immediately re-clamps the slider value to the new floor if it was below it
- [ ] **C3**: After fetch, the initial `milestoneThreshold` is clamped to the floor (never below `currentViews × 1.20`)
- [ ] **I2**: `handleResolutionButton` clamps to the updated `milestoneMin` (no separate fix needed — it references `milestoneMin`)
- [ ] **I4**: `milestoneStep` is `computeStep(max(milestoneFloor, anchor))`, not `computeStep(anchor)` alone
- [ ] **R10**: A "Current: X views/likes" label appears below the slider track when a video is loaded and contract has resolved; updates on `questionType` change
- [ ] **Server guard**: `createMarket` rejects a `milestoneThreshold` below `initialCount × 1.20` with an actionable error message
- [ ] Existing proportional coupling (slider ↔ resolution buttons) continues to work correctly
- [ ] All existing tests in `src/app/admin/markets/new/__tests__/helpers.test.ts` continue to pass
- [ ] New unit tests cover: floor wins over 0.1× anchor, floor > 5× anchor (max raised), zero-analytics degenerate case

## Success Metrics

- No market can be created with a milestone at or below the video's current analytics count
- The admin can see the current analytics count at all times while adjusting the slider
- The slider remains usable (min < max) for all realistic video/anchor combinations, including already-viral videos

## Dependencies & Risks

- **`formatCount` formatter**: Used for R10 label. Confirm it handles values under 1,000 gracefully (e.g., `842` → `"842"`, not `"0.8K"`). Check `src/lib/format.ts` during implementation.
- **`computeStep` from helpers.ts**: Step logic change (I4) must be validated for step=0 edge case when `milestoneFloor === 0` (zero-view video path). This is a degenerate case — add a `Math.max(step, 1)` guard.
- **questionType and likeCount = 0**: If a video has disabled likes, `likeCount` is `0` and the floor becomes `max(0.1× anchor, 0) = 0.1× anchor`. The "Current: 0 likes" label is factually correct but potentially confusing. A follow-up could add a "(likes unavailable)" note — out of scope for this plan.

## Files to Touch

| File | Change |
|---|---|
| `src/app/admin/markets/new/page.tsx` | Update `milestoneMin/Max/Step` derivations; clamp initial state; add `useEffect` for questionType clamp; add R10 label |
| `src/lib/actions/admin.ts` | Add server-side floor validation in `createMarket` |
| `src/app/admin/markets/new/__tests__/helpers.test.ts` | Add floor-formula unit tests |

## Sources & References

### Origin
- **Origin document:** [docs/brainstorms/2026-03-23-market-creation-proportional-controls-requirements.md](../brainstorms/2026-03-23-market-creation-proportional-controls-requirements.md)
  Key decisions carried forward: (1) 20% floor over current analytics as hard minimum, (2) current analytics displayed near slider, (3) questionType defaults to views

### Internal References
- Market creation form: `src/app/admin/markets/new/page.tsx` — lines 63–79 (state), 116 (initial set), 164 (resolution button handler), 340–349 (slider JSX)
- Server action: `src/lib/actions/admin.ts:240` — `createMarket`; lines 260–300 (validation block)
- Step helper: `src/app/admin/markets/new/helpers.ts` — `computeStep`
- Format utility: `src/lib/format.ts` — `formatCount`
- Existing tests: `src/app/admin/markets/new/__tests__/helpers.test.ts`

### Related Plans
- [2026-03-23-004 — Proportional Milestone & Resolution Controls](./2026-03-23-004-feat-proportional-milestone-resolution-controls-plan.md) (completed — built slider/pill buttons this plan extends)
