---
status: pending
priority: p1
issue_id: "007"
tags: [code-review, performance, correctness]
dependencies: []
---

# Replace distributePayout / refundPositions N+1 Loops with Bulk SQL

## Problem Statement

`distributePayout` and `refundPositions` both fetch all winning/open positions in one query, then loop over each position issuing 2-3 individual DB round-trips per position (UPDATE users, INSERT coinTransactions, and in refund: UPDATE positions). For markets with hundreds of participants, this creates 500-1500 round-trips inside a single transaction, risking a 30-second Neon serverless timeout that leaves the market in `resolving` state with users never paid.

## Findings

- `src/lib/services/payout.ts:37-54`: `for (const position of toPay)` — 2 writes per position
- `src/lib/services/payout.ts:69-94`: `for (const position of allPos)` — 3 writes per position
- Neon serverless default statement timeout: 30 seconds
- At 500 positions × 20ms per write = 10 seconds (marginal); at 200 positions × 50ms (under load) = timeout
- A timed-out transaction leaves the market status as `resolving` permanently (the status update was in the same transaction)
- Affects both automatic resolution (cron) and manual resolution (admin action)

## Proposed Solutions

### Option 1: Bulk SQL Set-Based Statements

**Approach:** Replace loops with single bulk statements:

For `distributePayout`:
```typescript
// One UPDATE for all winners
await tx.execute(sql`
  UPDATE users SET balance = balance + p.shares::numeric
  FROM positions p
  WHERE users.id = p.user_id
    AND p.market_id = ${marketId}
    AND p.outcome = ${outcome}
    AND p.shares::numeric > 0
    AND p.user_id NOT IN (
      SELECT user_id FROM coin_transactions
      WHERE reference_id = ${marketId} AND type = 'payout'
    )
`);

// One bulk INSERT for all payout ledger entries
await tx.execute(sql`
  INSERT INTO coin_transactions (id, user_id, amount, type, reference_id, created_at)
  SELECT gen_random_uuid(), p.user_id, p.shares::numeric, 'payout', ${marketId}, NOW()
  FROM positions p
  WHERE p.market_id = ${marketId}
    AND p.outcome = ${outcome}
    AND p.shares::numeric > 0
    AND p.user_id NOT IN (
      SELECT user_id FROM coin_transactions
      WHERE reference_id = ${marketId} AND type = 'payout'
    )
`);
```

**Pros:** O(1) DB round-trips regardless of position count; eliminates timeout risk
**Cons:** Raw SQL (harder to maintain); Drizzle doesn't support this pattern natively

**Effort:** 3-4 hours
**Risk:** Medium (test carefully)

---

### Option 2: Batch in Groups of 50

**Approach:** Break the loop into batches of 50 positions, each in its own sub-transaction.

**Pros:** Limits per-batch timeout risk; easier to implement
**Cons:** Not truly atomic — partial batches can succeed while later ones fail

**Effort:** 2 hours
**Risk:** Medium

## Recommended Action

Option 1. This is a correctness issue (not just performance) — the timeout causes unpaid users. The bulk SQL approach is the only option that eliminates the risk entirely.

## Technical Details

**Affected files:**
- `src/lib/services/payout.ts` — both `distributePayout` and `refundPositions`

**Note:** `refundPositions` also needs to zero out positions in bulk:
```typescript
await tx.execute(sql`UPDATE positions SET shares = '0' WHERE market_id = ${marketId} AND shares::numeric > 0`);
```

## Acceptance Criteria

- [ ] `distributePayout` issues at most 3 DB statements regardless of winner count
- [ ] `refundPositions` issues at most 3 DB statements regardless of position count
- [ ] Idempotency is preserved (no double-payout on retry)
- [ ] A market with 500+ winning positions resolves successfully within the Neon timeout
- [ ] Both the cron auto-resolution and admin manual-resolve paths use the updated service

## Work Log

### 2026-03-22 - Discovery

**By:** Performance oracle (code review)
