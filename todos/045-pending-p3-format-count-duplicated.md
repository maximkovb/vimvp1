---
status: complete
priority: p3
issue_id: "045"
tags: [code-review, maintainability, quality]
dependencies: []
---

# `formatCount` Duplicated in Two Component Files

## Problem Statement

The `formatCount` utility function is defined identically in `VideoStatsChart.tsx` and `ChannelHistoryCards.tsx`. When the formatting rule changes (e.g., adding `B` for billions, changing `1.0M` to `1M`, or adding locale support), both files must be updated. In practice, one will be updated and the other will silently drift.

## Findings

- `src/components/VideoStatsChart.tsx`: 4-line `formatCount` defined locally
- `src/components/ChannelHistoryCards.tsx`: identical 4-line `formatCount` defined locally
- Code simplicity reviewer and architecture strategist both flagged this

## Proposed Solutions

### Solution A: Extract to `src/lib/format.ts` (Recommended)
```ts
// src/lib/format.ts
export function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}
```
Import in both component files.
- **Pros**: Single definition; any future change applies everywhere
- **Cons**: New file (trivial)
- **Effort**: Trivial
- **Risk**: None

## Recommended Action

Solution A. If `src/lib/format.ts` already exists for other helpers, add `formatCount` there.

## Technical Details

- **Affected files**: `src/components/VideoStatsChart.tsx`, `src/components/ChannelHistoryCards.tsx`, `src/lib/format.ts` (new)

## Acceptance Criteria

- [ ] `formatCount` defined once in `src/lib/format.ts`
- [ ] Both `VideoStatsChart.tsx` and `ChannelHistoryCards.tsx` import from `@/lib/format`
- [ ] `grep -r "function formatCount"` returns exactly one result

## Work Log

- 2026-03-23: Identified by architecture-strategist, kieran-typescript-reviewer, and code-simplicity-reviewer during code review of feat/video-intelligence-panel
