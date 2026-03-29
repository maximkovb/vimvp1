---
status: complete
priority: p2
issue_id: "050"
tags: [code-review, testing, quality]
---

# `snapToPreset` and `computeStep` have no unit tests

## Problem Statement

Two pure helper functions (`snapToPreset`, `computeStep`) added in this feature contain non-obvious logic with documented edge cases (tie-breaking rule, `anchor = 0` behavior) that are not covered by any tests. The tie-breaking rule ("ties go to shorter") is stated only in a JSDoc comment — a future change to the reduce comparison could silently break it.

## Findings

- **File:** `src/app/admin/markets/new/page.tsx` lines 15-27
- `snapToPreset`: `reduce` with strict `<` comparison means ties keep the first (shorter) preset — documented in comment but not verified
- `computeStep(1)` → step=1; `computeStep(100000)` → step=1000; `computeStep(0)` → step=1 (via accidental `Math.max(1,...)` recovery from `-Infinity`)
- Existing test file: `src/lib/__tests__/contract.test.ts` — natural home for contract-related utilities
- These functions are pure, have no dependencies, and are trivially testable in isolation

## Proposed Solutions

### Option A: Add to existing contract test file (Recommended)
Add a `describe('snapToPreset', ...)` and `describe('computeStep', ...)` block to `src/lib/__tests__/contract.test.ts`. To do this, the functions would need to be either exported from `page.tsx` (unusual for a client component) or moved to a shared utility file.
**Pros:** Tests live next to related contract tests. **Effort:** Small-Medium (requires moving functions).

### Option B: Test file in `__tests__` next to the component
Create `src/app/admin/markets/new/__tests__/helpers.test.ts`, export the helpers from a sibling file.
**Pros:** Tests stay close to the feature. **Effort:** Small-Medium.

### Option C: Inline snapshot tests in the component (not recommended)
**Cons:** Not idiomatic. Skip.

## Acceptance Criteria
- [ ] `snapToPreset(36)` returns `"24"` (tie between 24h and 48h goes to shorter)
- [ ] `snapToPreset(110)` returns `"72"` (closer to 72 than 168)
- [ ] `snapToPreset(168)` returns `"168"` (exact match)
- [ ] `computeStep(100000)` returns `1000`
- [ ] `computeStep(1)` returns `1`
- [ ] `computeStep(0)` returns `1` (not NaN or 0)
- [ ] Both functions are importable from a non-client module

## Work Log
- 2026-03-23: Found by TypeScript reviewer and architecture-strategist during `/ce:review` of proportional milestone/resolution controls feature
