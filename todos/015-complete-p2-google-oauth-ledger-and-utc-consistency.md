---
status: pending
priority: p2
issue_id: "015"
tags: [code-review, correctness, architecture]
dependencies: []
---

# Fix Google OAuth Users Missing Ledger Entry and UTC Inconsistency in Daily Reward

## Problem Statement

Two related issues: (1) Google OAuth users receive a starting balance of 1000 coins (from the schema default) but have no corresponding `coinTransactions` ledger entry — the `createUser` Auth.js event is an empty function; (2) the portfolio page checks `alreadyClaimed` using local time while `claimDailyReward` uses UTC, causing incorrect UI state for users near UTC midnight on non-UTC servers.

## Findings

**Issue A — Google OAuth ledger gap:**
- `src/lib/auth.ts:73-77`: `events.createUser` is an empty async function with a comment saying the bonus is handled in the signUp action
- `src/lib/actions/auth.ts` `signUp` only runs for credentials (email/password) sign-ups
- A Google OAuth new user gets a `users` row from `DrizzleAdapter` with `balance = "1000"` (schema default) but zero `coinTransactions` records
- The ledger is inconsistent from the first Google OAuth registration
- A user could check their transaction history and see 1000 coins with no origin record

**Issue B — UTC inconsistency:**
- `src/lib/actions/economy.ts:35-36`: uses `Date.UTC(...)` — UTC midnight
- `src/app/portfolio/page.tsx:29-33`: uses `new Date(); setHours(0,0,0,0)` — local midnight
- On Vercel (UTC server), these agree in production but disagree in any non-UTC development environment
- If server timezone is ever changed, the portfolio page could show "claim available" when the action would reject the claim, or vice versa

## Proposed Solutions

**Fix A — Google OAuth ledger:**

Implement the `createUser` event to award the signup bonus:
```typescript
events: {
  async createUser({ user }) {
    if (!user.id) return;
    await db.insert(coinTransactions).values({
      userId: user.id,
      amount: "1000.00",
      type: "signup_bonus",
      referenceId: user.id,
    });
  },
},
```

**Fix B — UTC normalization:**

In `portfolio/page.tsx`, replace local time check with UTC:
```typescript
const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const lastRewardUTC = user?.lastLoginReward
  ? new Date(Date.UTC(user.lastLoginReward.getUTCFullYear(), user.lastLoginReward.getUTCMonth(), user.lastLoginReward.getUTCDate()))
  : null;
const alreadyClaimed = lastRewardUTC?.getTime() === todayUTC.getTime();
```

**Effort:** 1 hour total | **Risk:** Low

## Technical Details

**Affected files:**
- `src/lib/auth.ts:73-77` — implement createUser event
- `src/app/portfolio/page.tsx:29-33` — fix UTC normalization

## Acceptance Criteria

- [ ] Google OAuth new user registration creates a `coinTransactions` record for the 1000-coin signup bonus
- [ ] The signup_bonus coinTransaction uses userId as referenceId (idempotent)
- [ ] Portfolio page `alreadyClaimed` check uses UTC midnight consistently with `economy.ts`
- [ ] Existing credentials-based signup bonus flow is unchanged

## Work Log

### 2026-03-22 - Discovery

**By:** TypeScript reviewer + Architecture strategist (code review)
