---
status: pending
priority: p3
issue_id: "081"
tags: [code-review, typescript, quality]
dependencies: ["068"]
---

# Literal union `24 | 48 | 72` duplicated across calibration, contract, Zod schemas — extract `ResolutionHours` type

## Problem Statement

The valid resolution hours `24 | 48 | 72` appear as a literal union in at least 4 places:
1. `HORIZON_FRACTION: Record<24 | 48 | 72, number>` — `calibration.ts`
2. `channelAvgAtHorizon(windowHours: 24 | 48 | 72)` — `calibration.ts`
3. `resolutionHours: 24 | 48 | 72` in `ContractRecommendation` — `contract.ts`
4. `z.union([z.literal(24), z.literal(48), z.literal(72)])` — `api/markets/route.ts`

Adding a 96-hour resolution window requires changes in all 4+ locations with no compiler guidance.

## Proposed Solution

```typescript
// src/lib/calibration.ts — add alongside HORIZON_FRACTION
export const RESOLUTION_HOURS = [24, 48, 72] as const;
export type ResolutionHours = (typeof RESOLUTION_HOURS)[number]; // 24 | 48 | 72
```

Then use `ResolutionHours` in all the places that currently write `24 | 48 | 72`:
```typescript
// contract.ts
resolutionHours: ResolutionHours;

// calibration.ts
channelAvgAtHorizon(channelAvgViews: number, windowHours: ResolutionHours): number

// api/markets/route.ts
resolutionHours: z.union(
  RESOLUTION_HOURS.map(h => z.literal(h)) as [z.ZodLiteral<24>, z.ZodLiteral<48>, z.ZodLiteral<72>]
)
// or: z.custom<ResolutionHours>(v => RESOLUTION_HOURS.includes(v as ResolutionHours))
```

- **Effort**: Small
- **Risk**: Low — TypeScript-only refactor; no runtime change

## Acceptance Criteria

- [ ] `ResolutionHours` type exported from `calibration.ts`
- [ ] `RESOLUTION_HOURS` array exported from `calibration.ts`
- [ ] `24 | 48 | 72` literal union removed from all usage sites in favor of `ResolutionHours`
- [ ] Adding a new resolution hours value requires changing only `calibration.ts`
- [ ] TypeScript compiles clean

## Work Log

- 2026-03-27: Identified during `/ce:review` — kieran-typescript-reviewer (P3)
