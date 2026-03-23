---
status: pending
priority: p3
issue_id: "032"
tags: [code-review, typescript, dry, maintainability]
dependencies: ["031"]
---

# Confidence→RiskTier Mapping Duplicated in `prediction.ts` and `contract.ts`

## Problem Statement

The `confidenceLevel → riskTier` mapping is implemented twice: once as an inline ternary chain in `prediction.ts:230-235` and once implicitly via `assignRiskTier()` in `contract.ts:18-22`. Both express the same "high confidence = low risk" inversion. If the tier boundaries change, both code paths must be updated in sync. The ternary chain in `prediction.ts` is also harder to read than a lookup map.

## Findings

- `prediction.ts:230-235` — inline ternary: `confidenceLevel === "high" ? "low" : ...`
- `contract.ts:18-22` — `assignRiskTier(confidence: number)` maps numeric score to `RiskTier`
- Both express: high confidence/confidence → low risk tier

## Proposed Solutions

### Option 1: Add a lookup constant to `contract.ts` and import it in `prediction.ts` (Recommended)

```typescript
// contract.ts
export const CONFIDENCE_TO_RISK_TIER: Record<
  LLMContractRecommendation["confidenceLevel"],
  RiskTier
> = {
  high: "low",
  medium: "medium",
  low: "high",
};
```

```typescript
// prediction.ts
import { CONFIDENCE_TO_RISK_TIER } from "./contract";
const riskTier = CONFIDENCE_TO_RISK_TIER[parsed.confidenceLevel];
```

**Pros:** Single source of truth; removes ternary chain; self-documenting
**Effort:** Small  **Risk:** Low

## Acceptance Criteria

- [ ] `CONFIDENCE_TO_RISK_TIER` constant exported from `contract.ts`
- [ ] `prediction.ts` uses the constant instead of the inline ternary chain
- [ ] No behavior change

## Work Log

### 2026-03-23 - Discovery

**By:** TypeScript Reviewer (code review agent)
