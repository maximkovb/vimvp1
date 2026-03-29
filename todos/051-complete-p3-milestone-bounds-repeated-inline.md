---
status: complete
priority: p3
issue_id: "051"
tags: [code-review, quality, simplicity]
---

# Milestone bounds (`0.1×` and `5×` anchor) computed 5 times inline

## Problem Statement

`Math.round(anchorMilestone * 0.1)` and `Math.round(anchorMilestone * 5)` appear 5 times across `handleResolutionButton` and the slider JSX (min label, max label, `min` prop, `max` prop). If the range policy changes (e.g., from 0.1×–5× to 0.2×–4×), it must be updated in 5 places. Extracting them as named derived constants also makes the semantics explicit.

## Findings

- **File:** `src/app/admin/markets/new/page.tsx`
- Occurrences: `handleResolutionButton` (lines ~165-166), JSX left label (line ~330), JSX right label (line ~340), slider `min` (line ~347), slider `max` (line ~348)
- Also: `computeStep(anchorMilestone)` computed on every render but only changes when anchor changes

## Proposed Solution

Add two derived values near the state declarations:

```ts
const milestoneMin = anchorMilestone ? Math.round(anchorMilestone * 0.1) : 0;
const milestoneMax = anchorMilestone ? Math.round(anchorMilestone * 5) : 100;
```

Then replace all inline expressions with `milestoneMin`/`milestoneMax`. This also simplifies `handleResolutionButton`:

```ts
setMilestoneThreshold(String(Math.max(milestoneMin, Math.min(milestoneMax, raw))));
```

Optionally, also derive `milestoneStep`:
```ts
const milestoneStep = anchorMilestone ? computeStep(anchorMilestone) : 1;
```

## Acceptance Criteria
- [ ] `milestoneMin` and `milestoneMax` are derived once at render time
- [ ] The slider `min`/`max` props, label spans, and `handleResolutionButton` clamp all reference the derived constants
- [ ] No functional behavior change (min=0.1×anchor, max=5×anchor throughout)

## Work Log
- 2026-03-23: Found by simplicity-reviewer and performance-oracle during `/ce:review` of proportional milestone/resolution controls feature
