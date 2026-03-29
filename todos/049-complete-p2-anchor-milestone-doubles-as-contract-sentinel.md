---
status: complete
priority: p2
issue_id: "049"
tags: [code-review, architecture, ux]
---

# `anchorMilestone` doubles as both proportional anchor and feature-lock sentinel

## Problem Statement

`anchorMilestone` serves two distinct roles: (1) the AI recommendation value used for proportional math, and (2) the boolean gate that controls whether the form is ready to submit and whether controls are enabled. This conflation means that when `fetchVideoMetadata` returns a valid video preview but `contract: null` (analytics/LLM failure), the slider, pill buttons, and submit button are all permanently disabled — even though the video is loaded and the form was previously submittable. This is a behavioral regression from the pre-feature form behavior.

## Findings

- **File:** `src/app/admin/markets/new/page.tsx`
- `disabled={!anchorMilestone}` appears on slider (line ~346), all 4 pill buttons (line ~374), and submit button (line ~428)
- `anchorMilestone` is only set inside `if (result.contract)` — so `contract: null` leaves it null forever
- Before this change: submit button was `disabled={isPending || !videoPreview}` — submittable even when the contract was null
- The `contract: null` path is real: the outer `try/catch` in `admin.ts` absorbs all analytics failures silently
- The two concerns are: "do we have anchor values for proportional math?" and "is the form ready to submit?"

## Proposed Solutions

### Option A: Separate the sentinel from the anchor (Recommended)
Introduce an explicit `contractLoaded` boolean:
```ts
const contractLoaded = anchorMilestone !== null;
```
Use `contractLoaded` for the disabled gates, keep `anchorMilestone` only for math. Revert the submit button to `disabled={isPending || !videoPreview}` OR gate it on `contractLoaded` if the intent is to require AI data (document this clearly).
**Pros:** Self-documenting, single place to change if the gate logic evolves. **Effort:** Small.

### Option B: Accept the behavioral change but document it
If preventing submission without AI contract data is intentional policy, add a visible UI message explaining why the submit button is disabled when no contract was returned.
**Pros:** Honest UX. **Cons:** Admins lose ability to create markets when analytics fail. **Effort:** Small.

### Option C: Fallback anchor from defaults when contract is null
If `contract` is null, set sensible defaults: `setAnchorMilestone(1000000); setAnchorHours(72)` so the slider is usable without AI data.
**Pros:** Form always usable. **Cons:** The anchor is fabricated, proportional linking is meaningless. **Effort:** Small.

## Acceptance Criteria
- [ ] When video fetch returns a valid `videoPreview` but `contract: null`, the form is either (a) submittable with a clear explanation, or (b) blocked with a clear user-facing message — not silently broken
- [ ] `contractLoaded` (or equivalent) is derived explicitly rather than inferred from `anchorMilestone` truthiness
- [ ] The submit button's disabled condition is accompanied by a comment explaining each guard

## Work Log
- 2026-03-23: Found by architecture-strategist during `/ce:review` of proportional milestone/resolution controls feature
