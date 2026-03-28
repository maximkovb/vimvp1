---
status: pending
priority: p3
issue_id: "082"
tags: [code-review, quality, calibration]
dependencies: []
---

# `resolutionHours` allowlist check in `createMarket` runs after `computeExpectedOutcome` — wrong order

## Problem Statement

In `src/lib/actions/admin.ts` `createMarket()`:

```typescript
const resolutionHoursNum = parseInt(resolutionHours || "72");  // line 408
const requiredFloor = computeExpectedOutcome(               // line 409 — uses unvalidated value
  currentViews, videoAgeHoursVal, resolutionHoursNum, channelAvgViewsVal
);
// ...
if (![24, 48, 72].includes(hours)) {                       // line 435 — allowlist check AFTER
  return { error: "resolutionHours must be 24, 48, or 72" };
}
```

The floor guard runs with an arbitrary integer before the allowlist check fires. If `resolutionHours` is not in `[24, 48, 72]`, `computeExpectedOutcome` runs with a non-preset value (falling into the 72h fraction bucket), produces a floor, compares it against the milestone, and then the allowlist check rejects the request. This is not exploitable (the request is still rejected), but:
1. It's semantically confusing — validation should precede computation
2. `parseInt("abc")` returns `NaN`, and `NaN < requiredFloor` is `false` → floor check silently skipped for garbage inputs

## Proposed Solution

Move the allowlist check before `computeExpectedOutcome`:

```typescript
const resolutionHoursNum = parseInt(resolutionHours || "");
if (![24, 48, 72].includes(resolutionHoursNum) || isNaN(resolutionHoursNum)) {
  return { error: "resolutionHours must be 24, 48, or 72" };
}
// Now safe to use resolutionHoursNum in floor computation
const requiredFloor = computeExpectedOutcome(currentViews, videoAgeHoursVal, resolutionHoursNum, channelAvgViewsVal);
```

- **Effort**: Small
- **Risk**: Low — reordering only; behavior is identical for valid inputs

## Acceptance Criteria

- [ ] `resolutionHours` allowlist and NaN check comes before `computeExpectedOutcome` call
- [ ] `parseInt("abc")` or other non-numeric inputs are explicitly rejected before floor computation
- [ ] All existing tests pass

## Work Log

- 2026-03-27: Identified during `/ce:review` — architecture-strategist (P3-A), security-sentinel (P2-6, downgraded to P3 since not exploitable)
