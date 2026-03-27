---
status: complete
priority: p1
issue_id: "061"
tags: [code-review, ui, calibration]
dependencies: []
---

# `ProbabilityBadge` shows green checkmark for 40–60% — target is 25–45%

## Problem Statement

`ProbabilityBadge` in `src/app/admin/markets/new/page.tsx` renders a green checkmark (✓) when probability is `>= 0.4 && <= 0.6`. The documented probability target across the entire system is **25–45%** (not 40–60%). This means:

- A 55% probability (explicitly flagged as "too easy" in the LLM system prompt) gets a **green checkmark**.
- A correctly-calibrated 27% probability gets a **warning icon (⚠)**.

The badge is the admin's primary at-a-glance signal for catching miscalibrated LLM outputs. When it lies, the admin will approve markets that are too easy and investigate markets that are well-calibrated.

## Findings

- **`src/app/admin/markets/new/page.tsx` line 41**: `const isCalibrated = probability >= 0.4 && probability <= 0.6;`
- The 25–45% target is documented in: `src/lib/calibration.ts` (line ~12 JSDoc), `src/lib/prediction.ts` (system prompt), `src/lib/contract.ts` (multiplier comments), and the plan at `docs/plans/2026-03-27-002-fix-contract-calibration-channel-baseline-plan.md`.
- The stale range is likely a copy from the old 40–60% target that was the pre-PR default.

## Proposed Solutions

### Option A — One-line fix (Recommended)

```typescript
// Before
const isCalibrated = probability >= 0.4 && probability <= 0.6;

// After
const isCalibrated = probability >= 0.25 && probability <= 0.45;
```

- **Effort**: Trivial
- **Risk**: Zero

### Option B — Import a constant from calibration.ts

Define `CALIBRATION_TARGET_MIN = 0.25` and `CALIBRATION_TARGET_MAX = 0.45` in `src/lib/calibration.ts` and import them in `page.tsx`. This ensures the badge range tracks the canonical target automatically if the target changes in the future.

- **Pros**: Single source of truth for the target range.
- **Cons**: Minor added indirection for a trivial fix.
- **Effort**: Small

## Recommended Action

Option A now, Option B if the target range needs to change frequently (unlikely given it took a full brainstorm+plan cycle to shift it).

## Acceptance Criteria

- [ ] Badge renders green checkmark for probability = 0.25
- [ ] Badge renders green checkmark for probability = 0.45
- [ ] Badge renders warning icon for probability = 0.20 (below target)
- [ ] Badge renders warning icon for probability = 0.55 (above target — formerly green, now warning)

## Work Log

- 2026-03-27: Identified during `/ce:review` — kieran-typescript-reviewer, architecture-strategist
