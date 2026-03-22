---
status: pending
priority: p3
issue_id: "017"
tags: [code-review, quality, correctness]
dependencies: []
---

# Standardize outcome Semantics: 0=YES 1=NO Inconsistency Across Codebase

## Problem Statement

The `outcome` field (0 or 1 for YES/NO) has inconsistent documentation across files. The schema comment says `0=NO, 1=YES` but `TradePanel.tsx` initializes with `useState(0)` labeled `// 0=YES, 1=NO` and renders 0 as "YES". The market page renders `outcome === 1 ? "YES" : "NO"`. The storage model aligns with `0=YES` (index into `[qYes, qNo]`) but the schema comment says the opposite. This will confuse future developers and mislead any agent building a trading client.

## Findings

- `src/db/schema.ts:101`: comment says `// null until resolved; 0=NO, 1=YES`
- `src/db/schema.ts:135`: `// 0=NO, 1=YES`
- `src/components/TradePanel.tsx:14`: `useState<number>(0); // 0=YES, 1=NO`
- `src/app/markets/[id]/page.tsx:158`: `trade.outcome === 1 ? "YES" : "NO"` — treats 1 as YES
- `src/lib/lmsr.ts`: `quantities[0]` is `quantityYes`, `quantities[1]` is `quantityNo` — so index 0 = YES
- `src/lib/actions/trade.ts`: `buyShares(marketId, 0, amount)` → buys into `quantities[0]` = YES — confirms 0=YES

The actual behavior (0=YES, 1=NO) contradicts the schema comments (which say 0=NO, 1=YES). The schema comments are wrong.

## Proposed Solutions

### Option 1: Fix the Comments

**Approach:** Update all schema comments and any other wrong comments to correctly document `0=YES, 1=NO`. No data or code behavior changes.

**Pros:** Minimal change; no risk of breaking anything
**Cons:** Doesn't enforce the convention in the type system

**Effort:** 30 minutes
**Risk:** Very Low

---

### Option 2: Introduce Named Constants

**Approach:** Add constants and use them everywhere:
```typescript
export const OUTCOME_YES = 0;
export const OUTCOME_NO = 1;
```
Replace all magic `0` and `1` literals in trade-related code with named constants.

**Pros:** Self-documenting; no ambiguity; easier for agents/developers to understand
**Cons:** More files to change

**Effort:** 2 hours
**Risk:** Low (logic unchanged, only naming)

## Recommended Action

Option 1 as immediate fix (correct the wrong comments); Option 2 as a follow-up improvement.

## Technical Details

**Affected files (comments to fix):**
- `src/db/schema.ts:101, 135` — change `0=NO, 1=YES` to `0=YES, 1=NO`
- `src/components/TradePanel.tsx:14` — comment already correct (`0=YES`), just verify

## Acceptance Criteria

- [ ] Schema comments correctly document `0=YES, 1=NO` consistently
- [ ] All outcome-related comments in the codebase agree on the convention
- [ ] No behavior changes — only documentation/naming

## Work Log

### 2026-03-22 - Discovery

**By:** TypeScript reviewer + Agent-native reviewer + Architecture strategist (code review)
