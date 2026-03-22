---
status: pending
priority: p3
issue_id: "018"
tags: [code-review, quality, correctness]
dependencies: []
---

# Fix Fragile Optimistic Lock Error Handling and Add Server-Side Retry

## Problem Statement

`buyShares` and `sellShares` identify concurrent-trade failures by pattern-matching on the error message string `"Concurrent trade detected"`. If the message changes, the catch silently stops working and unhandled errors reach Next.js. Additionally, there is no server-side retry loop — users always see an error when the optimistic lock fails, even under light load where a single retry would succeed.

## Findings

- `src/lib/actions/trade.ts:155`: `throw new Error("Concurrent trade detected, please retry")`
- `src/lib/actions/trade.ts:229`: `if (e instanceof Error && e.message.includes("Concurrent trade"))`
- `src/lib/actions/trade.ts:313, 371`: same pattern in sellShares
- String matching on error messages is fragile — any typo or refactor silently breaks the catch
- No retry: a user buying during a busy market will see "Price changed" on every conflict; must manually click again
- The version counter on markets is global per market — two concurrent trades on opposite outcomes still conflict

## Proposed Solutions

### Option 1: Custom Error Class + Retry Loop

**Approach:**
1. Create a custom error class:
```typescript
class ConcurrentTradeError extends Error {
  constructor() { super("Concurrent trade detected, please retry"); }
}
```
2. Throw it in place of `new Error("Concurrent trade...")`
3. Catch with `instanceof ConcurrentTradeError`
4. Add 2-iteration retry loop before returning the error to the client

**Pros:** Type-safe error identification; retries improve UX under load
**Cons:** Slightly more code

**Effort:** 1 hour | **Risk:** Low

---

### Option 2: Sentinel Return Value Instead of Throw

**Approach:** Instead of throwing, return a special sentinel from inside the transaction:
```typescript
if (!marketUpdated) return { concurrentTrade: true };
// Outside transaction:
if ("concurrentTrade" in result) { /* retry or return error */ }
```

**Pros:** No exceptions for control flow; cleaner
**Cons:** Drizzle transaction behavior: returning from the callback doesn't auto-rollback — would need to throw to rollback. This pattern doesn't work cleanly with db.transaction().

**Effort:** 1 hour | **Risk:** Medium

## Recommended Action

Option 1. Custom error class is the idiomatic TypeScript solution.

## Technical Details

**Affected files:**
- `src/lib/actions/trade.ts` — both `buyShares` (lines 154-156, 229-231) and `sellShares` (lines 311-313, 371-373)

## Acceptance Criteria

- [ ] Optimistic lock failures use a custom error class, not string matching
- [ ] `instanceof ConcurrentTradeError` used in catch blocks
- [ ] `buyShares` and `sellShares` retry up to 2 times before returning error to client
- [ ] User sees "Price changed" only after all retries are exhausted
- [ ] No behavior change for non-conflict trades

## Work Log

### 2026-03-22 - Discovery

**By:** TypeScript reviewer + Architecture strategist (code review)
