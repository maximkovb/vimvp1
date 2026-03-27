---
status: complete
priority: p2
issue_id: "063"
tags: [code-review, quality, contract]
dependencies: []
---

# `resolveWindow()` dead parameters create false impression of performance-aware window selection

## Problem Statement

`resolveWindow(videoAgeHours, _outperformanceFactor, _channelConsistency)` accepts two parameters that are silently ignored. The function only uses `videoAgeHours`. More importantly, `calculateContractRecommendations()` still **computes** `outperformanceFactor` and `channelConsistency` before calling `resolveWindow` — values that are calculated and immediately discarded. This is both wasted computation and misleading documentation: any reader of `calculateContractRecommendations` will believe window selection is performance-aware when it is purely age-based.

## Findings

- **`src/lib/contract.ts` lines 120–131**: `resolveWindow` signature has `_outperformanceFactor: number` and `_channelConsistency: number`
- **`src/lib/contract.ts` lines 169–181**: `calculateContractRecommendations` computes both values and passes them to `resolveWindow` where they are discarded:
  ```typescript
  const outperformanceFactor = channelAvgViews > 0 ? currentViews / channelAvgViews : 1;
  const channelConsistency = channelAvgViews > 0 ? ... : 0.5;
  const window = resolveWindow(videoAgeHours, outperformanceFactor, channelConsistency);
  ```
- The underscore prefix signals intent ("I know it's unused") but does not eliminate the misleading call-site computation.
- **`src/lib/__tests__/contract.test.ts` lines 112–133**: Test calls pass dummy values like `resolveWindow(0, 1.0, 0.8)` — these will need updating when the signature is narrowed.

## Proposed Solution

1. Remove dead params from `resolveWindow`:
   ```typescript
   export function resolveWindow(videoAgeHours: number): 24 | 48 | 72
   ```
2. Remove `outperformanceFactor` and `channelConsistency` computation in `calculateContractRecommendations` (if not used elsewhere in the function — verify before deleting).
3. Update the two call sites (the function itself and the test suite).

Note: verify whether `outperformanceFactor` or `channelConsistency` are used anywhere else in `calculateContractRecommendations` before deleting them — they may be referenced in the multiplier selection or `estimatedProbability` computation.

- **Effort**: Small
- **Risk**: Low — purely a signature cleanup; the logic is already pure age-based and the tests already assert age-based behaviour

## Acceptance Criteria

- [ ] `resolveWindow` accepts only `videoAgeHours: number`
- [ ] No computation of `outperformanceFactor` or `channelConsistency` in `calculateContractRecommendations` unless used elsewhere in that function
- [ ] All `contract.test.ts` tests pass with the simplified call sites
- [ ] TypeScript compiles clean

## Work Log

- 2026-03-27: Identified during `/ce:review` — kieran-typescript-reviewer, architecture-strategist
