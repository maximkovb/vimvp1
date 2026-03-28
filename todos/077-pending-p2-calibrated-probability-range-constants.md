---
status: pending
priority: p2
issue_id: "077"
tags: [code-review, architecture, calibration, quality]
dependencies: ["068"]
---

# Calibrated probability range (25–45%) hardcoded in 3 places — should be exported from `calibration.ts`

## Problem Statement

The target probability range `0.25–0.45` (the "green zone" for well-calibrated markets) is encoded independently in three files:

1. `src/lib/prediction.ts` system prompt: `"target probability: 25–45% YES"`
2. `src/lib/prediction.ts` tool schema: `"estimatedProbability between 0.25 and 0.45"`
3. `src/app/admin/markets/new/page.tsx` `ProbabilityBadge`: `probability >= 0.25 && probability <= 0.45`

A decision to change the range (e.g., to 0.20–0.50 for wider tolerance) requires edits in three files, with the LLM prompt update being easy to miss. `calibration.ts` is already the single source of truth for probability math — these constants belong there.

## Proposed Solution

```typescript
// src/lib/calibration.ts — add alongside HORIZON_FRACTION
/** Target probability range for well-calibrated markets (lean toward failure). */
export const CALIBRATED_PROB_MIN = 0.25;
export const CALIBRATED_PROB_MAX = 0.45;
```

```typescript
// src/lib/prediction.ts — import and use in prompt:
import { CALIBRATED_PROB_MIN, CALIBRATED_PROB_MAX } from "./calibration";
// In system prompt:
`target probability: ${Math.round(CALIBRATED_PROB_MIN * 100)}–${Math.round(CALIBRATED_PROB_MAX * 100)}% YES`
// In tool schema description:
`estimatedProbability between ${CALIBRATED_PROB_MIN} and ${CALIBRATED_PROB_MAX}`

// src/app/admin/markets/new/page.tsx:
import { CALIBRATED_PROB_MIN, CALIBRATED_PROB_MAX } from "@/lib/calibration";
const isCalibrated = probability >= CALIBRATED_PROB_MIN && probability <= CALIBRATED_PROB_MAX;
```

- **Effort**: Small
- **Risk**: Low — no logic change, constants only

## Acceptance Criteria

- [ ] `CALIBRATED_PROB_MIN` and `CALIBRATED_PROB_MAX` exported from `calibration.ts`
- [ ] `prediction.ts` system prompt uses the constants (not hardcoded percentages)
- [ ] `ProbabilityBadge` in `page.tsx` uses the constants
- [ ] Changing a value in `calibration.ts` updates all three usage sites
- [ ] TypeScript compiles clean

## Work Log

- 2026-03-27: Identified during `/ce:review` — architecture-strategist (P2-E)
