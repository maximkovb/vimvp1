---
status: pending
priority: p1
issue_id: "001"
tags: [code-review, typescript, safety]
dependencies: []
---

# Fix Non-Null Assertion `data!` in MarketLiveData

## Problem Statement

`MarketLiveData.tsx` uses `const market = data!` (line 42) to silence TypeScript, but `data` can be `undefined` during SWR revalidation. This is a type-safety bypass that could cause a runtime crash if SWR momentarily returns `undefined` before `fallbackData` is applied.

## Findings

- `src/components/MarketLiveData.tsx:42` — `const market = data!;` bypasses TypeScript's null check
- SWR's `fallbackData` guarantees `data` is never `undefined` at render time _after the first render_, but the `!` assertion obscures this and creates risk if the hook config changes
- `LiveEngagementStats.tsx` handles this correctly with `const market = data ?? initialData;` (the pattern is already established in the codebase)
- Using `data ?? initialData` makes the fallback explicit and removes the assertion

## Proposed Solutions

### Option 1: Replace assertion with nullish coalescing (Recommended)

**Approach:** Change `const market = data!;` to `const market = data ?? initialData;`

**Pros:**
- Matches the pattern already used in `LiveEngagementStats.tsx`
- TypeScript-correct, no assertions
- Removes silent crash risk if SWR config changes

**Cons:**
- None

**Effort:** 5 minutes

**Risk:** None — purely defensive

---

### Option 2: Keep assertion, add comment

**Approach:** Add a comment explaining why `data` is always defined.

**Pros:**
- No logic change

**Cons:**
- Still bypasses TypeScript; future refactors can break silently
- Not consistent with existing pattern

**Effort:** 2 minutes

**Risk:** Low short-term, higher long-term

## Recommended Action

Implement Option 1: `const market = data ?? initialData;`

## Technical Details

**Affected files:**
- `src/components/MarketLiveData.tsx:42`

**Related components:**
- `src/components/LiveEngagementStats.tsx:26` — already uses correct pattern

## Resources

- **Branch:** feat/creator-baseline-card
- **Review finding:** kieran-typescript-reviewer (P1)

## Acceptance Criteria

- [ ] `const market = data!` replaced with `const market = data ?? initialData`
- [ ] TypeScript compiles without errors
- [ ] No `!` non-null assertions remain in MarketLiveData.tsx

## Work Log

### 2026-04-13 - Code Review Discovery

**By:** Claude Code (ce-review)

**Actions:**
- Identified non-null assertion on line 42 of MarketLiveData.tsx
- Found matching safe pattern in LiveEngagementStats.tsx
- Confirmed fix is trivial one-liner
