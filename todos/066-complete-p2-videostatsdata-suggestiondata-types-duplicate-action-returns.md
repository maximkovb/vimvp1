---
status: complete
priority: p2
issue_id: "066"
tags: [code-review, typescript, quality]
dependencies: []
---

# `VideoStatsData` and `SuggestionData` in `page.tsx` manually duplicate action return types

## Problem Statement

`src/app/admin/markets/new/page.tsx` defines two local types (`VideoStatsData` lines 55–65 and `SuggestionData` lines 67–75) that manually mirror the return shapes of `fetchVideoStats()` and `generateMarketSuggestion()`. If either action adds, removes, or renames a field, the local types silently diverge — TypeScript won't catch it because the assignment `setVideoStats(statsResult)` has no explicit type annotation forcing conformance.

This has already bitten the codebase before (see todo #049 — `anchorMilestone` doubling as contract sentinel) and will bite again as the suggestion pipeline evolves.

## Findings

- `page.tsx` line 55: `type VideoStatsData = { videoId: string; title: string; ... }`
- `page.tsx` line 67: `type SuggestionData = { contract: ...; suggestedTitle: string | null; videoAgeHours: number; ... }`
- `src/lib/actions/admin.ts` exports `fetchVideoStats` and `generateMarketSuggestion` with typed return values (`VideoStatsResult` and `SuggestionResult` discriminated unions)
- The two local page types are not `ReturnType`-derived; they are hand-written copies

## Proposed Solution

Derive the page types from the action return types using `Extract` to pick the success shape from the discriminated union:

```typescript
import type { fetchVideoStats, generateMarketSuggestion } from "@/lib/actions/admin";

type VideoStatsData = Extract<
  Awaited<ReturnType<typeof fetchVideoStats>>,
  { videoId: string }
>;

type SuggestionData = Extract<
  Awaited<ReturnType<typeof generateMarketSuggestion>>,
  { contract: unknown }
>;
```

This ensures the page types are structurally in sync with the actions. Alternatively, export named success-shape types from `admin.ts` directly:

```typescript
// In admin.ts:
export type VideoStatsSuccess = { videoId: string; title: string; ... };
export type SuggestionSuccess = { contract: ...; suggestedTitle: string | null; ... };
```

- **Effort**: Small
- **Risk**: Low — purely a type-level refactor; no runtime behaviour change

## Acceptance Criteria

- [ ] `VideoStatsData` and `SuggestionData` in `page.tsx` are derived from (or imported from) the action return types, not hand-written
- [ ] Adding a field to `fetchVideoStats`'s return type causes a TS error at the `setVideoStats` assignment if the page type is not updated
- [ ] TypeScript compiles clean

## Work Log

- 2026-03-27: Identified during `/ce:review` — kieran-typescript-reviewer
