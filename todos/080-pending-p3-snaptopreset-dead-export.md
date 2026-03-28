---
status: pending
priority: p3
issue_id: "080"
tags: [code-review, quality]
dependencies: []
---

# `snapToPreset` exported and unit-tested in `helpers.ts` but never called — dead code

## Problem Statement

`snapToPreset` in `src/app/admin/markets/new/helpers.ts` is exported and has a corresponding test in `helpers.test.ts`, but it is not imported anywhere in `page.tsx` after the slider/resolution decoupling refactor. It was previously used in `handleMilestoneSlider` to snap the resolution window to the nearest preset when the slider moved, but that coupling was intentionally removed (one-way binding PR).

Dead exports mislead future developers into thinking the function is in use, and the associated test provides false coverage confidence for production paths.

## Proposed Solution

**Option A (Recommended):** Delete `snapToPreset` from `helpers.ts` and remove its test from `helpers.test.ts`.

**Option B:** Add a comment documenting that this function is intentionally retained for a planned future feature (if that is the case). Requires a specific issue reference.

- **Effort**: Small
- **Risk**: Zero — removing unused code

## Acceptance Criteria

- [ ] `snapToPreset` is removed from `helpers.ts` (or has a documented future-use comment)
- [ ] The `snapToPreset` test cases are removed from `helpers.test.ts`
- [ ] No import of `snapToPreset` anywhere in the codebase
- [ ] TypeScript compiles clean; test suite passes

## Work Log

- 2026-03-27: Identified during `/ce:review` — architecture-strategist (P3-D)
