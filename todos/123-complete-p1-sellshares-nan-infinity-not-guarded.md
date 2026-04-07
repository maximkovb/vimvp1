---
name: sellShares does not guard against NaN/Infinity input
description: NaN passes the sharesToSell > 0 guard in sellShares, leading to corrupted trade math
type: bug
status: pending
priority: p1
issue_id: "123"
tags: [code-review, security, lmsr, input-validation]
dependencies: []
---

## Problem Statement

`sellShares` in `src/lib/actions/trade.ts` validates `sharesToSell <= 0` but does not check `isFinite(sharesToSell)`. `NaN > 0` is `false`, so NaN passes the guard and is passed to `tradeCost()` — producing NaN refund values that get stored in the DB. `Infinity` correctly hits the `> currentShares` guard, but `NaN` does not.

**Why:** Input validation only checked the sign, not finiteness.

## Findings

- **`src/lib/actions/trade.ts:260`**: `if (sharesToSell <= 0) return { error: "..." }` — NaN passes this
- `tradeCost(quantities, b, outcome, NaN)` → NaN arithmetic → `refund = NaN` → `NaN.toFixed(2)` throws or stores "NaN" string

## Proposed Solutions

### Option A: Add isFinite guard
```ts
if (!isFinite(sharesToSell) || sharesToSell <= 0) {
  return { error: "Must sell a positive number of shares" };
}
```
- **Effort:** Tiny (1 line change)
- **Risk:** None

## Acceptance Criteria
- [ ] `sellShares` with `NaN` returns error immediately
- [ ] `sellShares` with `Infinity` returns error immediately
- [ ] Normal positive finite values work as before

## Work Log
- 2026-04-06: Identified by security-sentinel during ce:review
