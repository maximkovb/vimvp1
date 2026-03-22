---
status: pending
priority: p1
issue_id: "005"
tags: [code-review, correctness, financial]
dependencies: []
---

# Block Cancellation of Resolving Markets — Prevents Double-Credit (Payout + Refund)

## Problem Statement

`cancelMarket` allows cancelling markets in `resolving` and `failed` states. If a market has partially paid out (some users received payout coins from `distributePayout` before a failure), then cancelling it runs `refundPositions`, which refunds based on `avgCostBasis * shares` for ALL positions — including those where `shares` haven't been zeroed by the failed payout. These users receive both a payout and a refund, creating coins out of thin air.

## Findings

- `src/lib/actions/admin.ts:177-179`: cancel is blocked only for `resolved` and `cancelled` status
- `resolving` and `failed` markets CAN be cancelled
- `distributePayout` (payout.ts:37-54) does NOT zero `positions.shares` — only updates `users.balance` and inserts coinTransactions
- `refundPositions` (payout.ts:61-94) checks `ne(positions.shares, "0")` — so winning positions that received a payout but weren't zeroed will ALSO get a refund
- A partially-paid-then-cancelled market creates coins = (payout amount) for affected users
- The `distributePayout` idempotency check (alreadyPaid set) prevents double-payout but doesn't prevent payout+refund

## Proposed Solutions

### Option 1: Block Cancel for Resolving Markets (Minimal Fix)

**Approach:** Add `market.status === "resolving"` to the cancel block condition.

```typescript
if (market.status === "resolved" || market.status === "cancelled" || market.status === "resolving") {
  return { error: "Cannot cancel a resolved, resolving, or already cancelled market" } as const;
}
```

**Pros:** One-line fix; eliminates the double-credit path
**Cons:** Leaves `failed` markets cancellable (which is still risky if partially paid)

**Effort:** 5 minutes
**Risk:** Low

---

### Option 2: Block Cancel for Resolving AND Failed Markets

**Approach:** Also block `failed` markets from cancellation. `failed` means resolution was attempted; `manualResolve` is the correct path.

**Pros:** Correct semantics — admin must use manualResolve for failed/resolving markets
**Cons:** Reduces admin options (but adds safety)

**Effort:** 10 minutes
**Risk:** Low

---

### Option 3: Zero Positions in distributePayout

**Approach:** Have `distributePayout` zero the winning positions' shares after paying them out, so refund would correctly return 0.

**Pros:** Makes system state fully consistent regardless of cancel order
**Cons:** Larger change to payout.ts; positions for non-winning sides still have shares

**Effort:** 2 hours
**Risk:** Medium

## Recommended Action

Option 2 — block both `resolving` and `failed` from cancellation. `manualResolve` already handles these states and is the correct admin tool for stuck markets.

## Technical Details

**Affected files:**
- `src/lib/actions/admin.ts:177-179` — update cancel guard

**Current code:**
```typescript
if (market.status === "resolved" || market.status === "cancelled") {
```

**Fixed code:**
```typescript
if (["resolved", "cancelled", "resolving", "failed"].includes(market.status)) {
```

Update the error message accordingly.

## Acceptance Criteria

- [ ] `cancelMarket` returns an error for markets in `resolving` state
- [ ] `cancelMarket` returns an error for markets in `failed` state
- [ ] `draft`, `active`, and `halted` markets can still be cancelled
- [ ] `manualResolve` is the documented path for resolving stuck markets

## Work Log

### 2026-03-22 - Discovery

**By:** Architecture strategist (code review)
