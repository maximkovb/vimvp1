---
name: No formatOutcome() utility — raw outcome ternaries caused the P1 inversion bug
description: 10+ components use raw `outcome === 0 ? "YES" : "NO"` (or inverted), creating a single point of failure for encoding changes
type: quality
status: pending
priority: p3
issue_id: "146"
tags: [code-review, typescript, code-quality, architecture]
dependencies: [120]
---

## Problem Statement

The `0/1` outcome encoding is repeated as raw inline ternaries in 10+ components. As shown in todo #120 (outcome inversion), 4 components used the wrong convention (`outcome === 1 ? "YES"`) while 6 used the correct one. A shared `formatOutcome()` utility would have made this a compile-time error when the encoding assumption changed.

## Findings

Inconsistent usage across: `MarketCard.tsx`, `MarketLiveData.tsx`, `history/page.tsx`, `portfolio/page.tsx`, `ResolutionReveal.tsx`, `ResolutionShareCard.tsx`, `PostTradeShareCard.tsx`, `BetSheet.tsx`, `TradePanel.tsx`

## Proposed Solutions

### Option A: Add formatOutcome to format.ts
```ts
// src/lib/format.ts
export function formatOutcome(outcome: number): "YES" | "NO" {
  return outcome === 0 ? "YES" : "NO"; // 0=YES, 1=NO per schema.ts:104
}
```
Replace all inline ternaries across the codebase with `formatOutcome(outcome)`.
- **Effort:** Small (add utility + 10 call site replacements)
- **Risk:** None — can be done after todo #120 is fixed to ensure correct convention

**Note:** Should be done after todo #120 (fixing the inversion) is complete.

## Acceptance Criteria
- [ ] `formatOutcome(outcome: number): "YES" | "NO"` exported from `src/lib/format.ts`
- [ ] All 10+ inline ternaries replaced with `formatOutcome()`
- [ ] TypeScript would catch any future convention change at all call sites

## Work Log
- 2026-04-06: Identified by architecture-strategist and TypeScript reviewer during ce:review
