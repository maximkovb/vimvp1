---
status: pending
priority: p3
issue_id: "031"
tags: [code-review, typescript, architecture]
dependencies: []
---

# Discriminated Union Uses Two Different Fields at Two Call Sites — No Closed-Form Base Discriminant

## Problem Statement

`LLMContractRecommendation` is detected at two different call sites using two different field names: `"predictionSource" in result.contract` (page.tsx:96) and `"predictionSource" in videoPreview.contract` (page.tsx:130). Additionally, the base `ContractRecommendation` type has no discriminant — the fallback path is identifiable only by the absence of `predictionSource`. This is an open-form union: adding a second LLM provider or a `"v2-llm"` variant requires auditing every `in` check across the codebase. The cast on line 132 (`as LLMContractRecommendation`) also bypasses the literal value check on `predictionSource`.

## Findings

- `page.tsx:96` — `"questionTypeRecommendation" in result.contract` to detect LLM path
- `page.tsx:130` — `"predictionSource" in videoPreview.contract` — different field, same intent
- `contract.ts:10-15` — `LLMContractRecommendation` adds `predictionSource: "llm"` but base has no discriminant
- `page.tsx:132` — `as LLMContractRecommendation` cast — bypasses literal value check

## Proposed Solutions

### Option 1: Add `predictionSource` to base type and extract a type guard (Recommended)

```typescript
// contract.ts
export interface ContractRecommendation {
  predictionSource: "algorithmic" | "llm";
  riskTier: RiskTier;
  milestoneThreshold: number;
  bParameter: number;
  resolutionHours: 24 | 48 | 72 | 168;
}

export function isLLMRecommendation(
  c: ContractRecommendation
): c is LLMContractRecommendation {
  return c.predictionSource === "llm";
}
```

Update `calculateContractRecommendations` to return `predictionSource: "algorithmic"`.
Replace both `in` checks in `page.tsx` with `isLLMRecommendation(contract)`.

**Pros:** Closed-form union; single narrowing function; removes the `as` cast
**Cons:** Requires updating `calculateContractRecommendations` return type
**Effort:** Small
**Risk:** Low

## Acceptance Criteria

- [ ] `ContractRecommendation` has a `predictionSource` discriminant
- [ ] `calculateContractRecommendations` returns `predictionSource: "algorithmic"`
- [ ] A single `isLLMRecommendation()` type guard exists in `contract.ts`
- [ ] No `as LLMContractRecommendation` casts in page.tsx
- [ ] Both detection call sites use the same guard function

## Work Log

### 2026-03-23 - Discovery

**By:** TypeScript Reviewer + Architecture Strategist (code review agents)
