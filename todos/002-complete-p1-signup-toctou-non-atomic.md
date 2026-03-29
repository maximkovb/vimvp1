---
status: pending
priority: p1
issue_id: "002"
tags: [code-review, security, correctness]
dependencies: []
---

# Fix signUp TOCTOU Race and Non-Atomic Transaction

## Problem Statement

The `signUp` server action has two related bugs: (1) the email uniqueness check and user insert are not in a single transaction, enabling a race condition that creates duplicate users with double signup bonuses; (2) the `users` insert and `coinTransactions` insert are sequential non-transactional writes, so a crash between them leaves a user with a balance but no ledger entry.

## Findings

- `src/lib/actions/auth.ts:25-52`: SELECT to check email, then INSERT user, then INSERT coinTransaction — three separate awaits with no transaction
- Two concurrent signups with the same email can both pass the `if (existing)` check before either insert commits
- The DB `UNIQUE` constraint on `users.email` prevents duplicate user rows, but the second request's coinTransaction insert may not roll back cleanly
- A crash between the user INSERT (line 39) and coinTransaction INSERT (line 48) leaves the user with balance=1000 but no ledger record
- This undermines ledger integrity from day one for the first credential signup

## Proposed Solutions

### Option 1: Single Transaction + Rely on DB Constraint

**Approach:** Wrap all three operations in `db.transaction()`. Remove the pre-check SELECT and instead catch the unique constraint violation on insert.

```typescript
try {
  return await db.transaction(async (tx) => {
    await tx.insert(users).values({ id: userId, name, email, passwordHash, balance: STARTING_BALANCE });
    await tx.insert(coinTransactions).values({ userId, amount: STARTING_BALANCE, type: "signup_bonus", referenceId: userId });
    return { success: true };
  });
} catch (e) {
  if (e.code === "23505") return { error: "An account with this email already exists" };
  throw e;
}
```

**Pros:** Atomic; eliminates TOCTOU entirely; consistent with how other actions handle transactions
**Cons:** Requires catching specific Postgres error code

**Effort:** 30 minutes
**Risk:** Low

---

### Option 2: Transaction + Keep Pre-check

**Approach:** Wrap in transaction AND keep the pre-check SELECT inside the transaction for a friendlier error message, relying on `FOR UPDATE` to lock the check.

**Pros:** Cleaner error messages; still atomic
**Cons:** Slightly more code; `FOR UPDATE` on a non-existent row requires a different pattern

**Effort:** 45 minutes
**Risk:** Low

## Recommended Action

Option 1. Also fix `coinTransactions` referenceId: use `userId` as the referenceId for `signup_bonus` so the unique index on `(userId, referenceId, type)` provides DB-level idempotency.

## Technical Details

**Affected files:**
- `src/lib/actions/auth.ts:25-65` — signUp action

**Database changes:**
- No migration needed
- `signup_bonus` coinTransaction should use `userId` as `referenceId` for idempotency

## Acceptance Criteria

- [ ] signUp user insert and coinTransaction insert are in a single `db.transaction()`
- [ ] Concurrent duplicate signups cannot create two users or double-credit coins
- [ ] A crash between the two inserts cannot leave partial state
- [ ] signup_bonus coinTransaction uses userId as referenceId
- [ ] Existing tests pass; add a concurrency test if the test suite allows

## Work Log

### 2026-03-22 - Discovery

**By:** TypeScript reviewer + Security sentinel (code review)
