---
status: complete
priority: p3
issue_id: "068"
tags: [code-review, calibration, quality]
dependencies: []
---

# Extract horizon fraction constants so `calibration.ts` and the LLM system prompt stay in sync

## Problem Statement

The accumulation ratios 55%/80%/100% for 24/48/72h windows appear twice:
1. As magic numbers in `channelAvgAtHorizon()` in `src/lib/calibration.ts`
2. As hardcoded percentages in the LLM system prompt in `src/lib/prediction.ts` (e.g., "at 24h, the expected outcome floor is ~55% of the channel average")

If empirical data shows the ratios need adjustment (e.g., Shorts actually peak in the first 12h so 24h accumulation is closer to 70%), **both locations must be updated separately**. The JSDoc on `channelAvgAtHorizon` acknowledges these are approximations requiring empirical tuning, but there's no mechanism to enforce that a tuning update propagates to the system prompt.

## Proposed Solution

Export named constants from `calibration.ts`:

```typescript
// src/lib/calibration.ts
export const HORIZON_FRACTION: Record<24 | 48 | 72, number> = {
  24: 0.55,
  48: 0.80,
  72: 1.00,
};
```

Use them in `channelAvgAtHorizon()`:

```typescript
export function channelAvgAtHorizon(channelAvgViews: number, windowHours: 24 | 48 | 72): number {
  return Math.round(channelAvgViews * HORIZON_FRACTION[windowHours]);
}
```

Import and use in the system prompt string in `prediction.ts`:

```typescript
import { HORIZON_FRACTION } from "./calibration";
// ...
`At 24h, the expected outcome floor is ~${Math.round(HORIZON_FRACTION[24] * 100)}% of the channel average...`
```

- **Effort**: Small
- **Risk**: Low — refactor only; no logic change

## Acceptance Criteria

- [ ] The 55%/80%/100% fractions are defined once in `calibration.ts` as exported constants
- [ ] `channelAvgAtHorizon` uses the constants instead of magic numbers
- [ ] The LLM system prompt in `prediction.ts` references the same constants
- [ ] Changing a fraction in one place updates both the algorithmic path and the LLM prompt

## Work Log

- 2026-03-27: Identified during `/ce:review` — architecture-strategist, learnings-researcher
