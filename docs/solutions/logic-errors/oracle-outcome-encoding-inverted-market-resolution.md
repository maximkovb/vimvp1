---
name: Oracle outcome encoding inverted — market resolution paid wrong side
description: resolveMarket() used outcome=1 for YES, but schema defines 0=YES. All auto-resolved markets paid NO holders instead of YES holders.
type: logic-errors
category: logic-errors
date: 2026-04-06
tags:
  - oracle
  - outcome-encoding
  - silent-data-corruption
  - payout-logic
  - lmsr
  - prediction-markets
  - tiktok-polls
  - cron
severity: critical
status: resolved
components:
  - src/lib/oracle.ts
  - src/lib/format.ts
  - src/components/AdminMarketActions.tsx
  - src/components/MarketCard.tsx
  - src/components/MarketLiveData.tsx
  - src/app/history/page.tsx
  - src/app/portfolio/page.tsx
related_issues: []
---

## Problem

Every market that auto-resolved via the milestone-detection cron job paid the **wrong side**. Users who bet "YES" (the milestone would be hit) received nothing; users who bet "NO" (it would not be hit) received the payout.

The bug was silent — no exceptions, no errors, no failed assertions. The cron job completed successfully and markets moved to `status: "resolved"`. The only observable symptom was that losing bettors received payouts and winning bettors did not.

## Root Cause

`src/lib/oracle.ts` contained an inverted ternary for the outcome assignment:

```ts
// WRONG — encodes milestone-hit as outcome=1 (NO per schema)
const outcome = metric !== null && metric >= market.milestoneThreshold ? 1 : 0;
```

The database schema (`src/db/schema.ts:104`) defines the encoding as:

```ts
outcome: integer; // 0=YES, 1=NO
```

So `outcome=1` means NO, but the oracle was setting `outcome=1` when the milestone **was** hit — the YES condition. Every auto-resolved market therefore recorded `outcome=1` (NO) and `distributePayout()` correctly paid all NO-position holders.

The inversion was present from the initial commit. No test exercised the end-to-end milestone → payout flow, so the bug was never caught.

## Secondary Bugs Found and Fixed

The audit to fix the oracle uncovered six additional outcome-encoding mistakes across the UI layer — all using `outcome === 1 ? "YES" : "NO"` instead of the correct `outcome === 0 ? "YES" : "NO"`:

| File | Location | Wrong | Fixed |
|---|---|---|---|
| `src/components/MarketCard.tsx` | Badge display | `outcome === 1 ? "YES"` | `outcome === 0 ? "YES"` |
| `src/components/MarketLiveData.tsx` | Trade history | `trade.outcome === 1` | `formatOutcome(trade.outcome)` |
| `src/app/history/page.tsx` | Trade history page | `outcome === 1` | `formatOutcome(t.trade.outcome)` |
| `src/app/portfolio/page.tsx` | Portfolio (3 instances) | `outcome === 1 ? "YES"` | `formatOutcome(p.position.outcome)` |
| `src/components/AdminMarketActions.tsx` | Manual resolve buttons | `manualResolve(id, 1)` for YES | `manualResolve(id, 0)` for YES |

The admin manual resolve buttons were also inverted — clicking "Resolve YES" was passing `outcome=1` (NO) to the API.

## Fix

### 1. Fix oracle.ts

```ts
// src/lib/oracle.ts
// BEFORE (wrong):
const outcome = metric !== null && metric >= market.milestoneThreshold ? 1 : 0;

// AFTER (correct — 0=YES per schema.ts:104):
const outcome = metric !== null && metric >= market.milestoneThreshold ? 0 : 1;
```

### 2. Add formatOutcome() utility to prevent recurrence

```ts
// src/lib/format.ts — new utility
export function formatOutcome(outcome: number): "YES" | "NO" {
  return outcome === 0 ? "YES" : "NO";
}
```

All UI outcome display now imports and uses `formatOutcome()`. Raw comparisons like `outcome === 1 ? "YES"` are no longer used anywhere.

### 3. Fix AdminMarketActions.tsx

```tsx
// "Resolve YES" — 0=YES
handleAction(() => manualResolve(marketId, 0));

// "Resolve NO" — 1=NO
handleAction(() => manualResolve(marketId, 1));
```

### 4. Fix all UI display sites

Replace `outcome === 1 ? "YES" : "NO"` with `formatOutcome(outcome)` in MarketCard, MarketLiveData, history/page.tsx, portfolio/page.tsx.

## Data Remediation

All markets that auto-resolved before this fix have incorrect payouts. To identify affected markets:

```sql
SELECT id, title, outcome, resolved_at
FROM markets
WHERE status = 'resolved'
ORDER BY resolved_at;
```

Payouts cannot be automatically reversed (credits have already been applied to user balances). Manual remediation or compensation is required for affected users. The `distributePayout` function uses non-reversible balance updates inside a transaction.

## Additional Issues Fixed in the Same Session

This review session also fixed 28 other bugs spanning the entire codebase. Notable ones:

- **bcrypt DoS** (`src/lib/actions/auth.ts`): Unbounded password length allowed CPU exhaustion. Fixed with `password.length > 72` guard.
- **SSRF via playUrl** (`src/lib/actions/admin.ts`): `playUrl` from browser form was stored and later used as a `fetch()` target. Fixed with `TIKTOK_PLAY_URL_RE` allowlist.
- **Non-atomic DB inserts** (`createMarket`, `buyShares`, `sellShares`): Multiple sequential inserts outside transactions. Wrapped in `db.transaction()`.
- **TOCTOU race in resolveNow** (`admin.ts`): Read-then-write without atomicity. Fixed with `.returning()` atomic guard.
- **N+1 in resolve cron**: Each market triggered an individual DB poll fetch. Fixed with batch `DISTINCT ON` query and `prefetched` parameter on `resolveMarket()`.
- **Agent-native parity gap**: No bearer-token routes for admin lifecycle or trading. Added 6 new API routes.
- **CSP `unsafe-eval` in production**: Conditioned to dev-only in `next.config.ts`.

## Prevention

### Outcome encoding rules

1. **Never write `outcome === 1 ? "YES"`** — the constant `1` is NO. Always use `formatOutcome(outcome)` for display.
2. **Never write `outcome: 1` for YES** — the constant `1` is NO. Always use `0` for YES literals.
3. **Add a comment at every raw outcome assignment**: `// 0=YES, 1=NO per schema.ts:104`
4. **Manual resolve UI buttons** must pass `0` for YES and `1` for NO — verify the direction whenever the UI is changed.

### Code review checklist (outcome encoding)

- [ ] Any new file displaying `outcome` uses `formatOutcome()`, not a raw ternary
- [ ] Any new file assigning `outcome` has a comment citing `schema.ts:104`
- [ ] Admin action handlers pass the correct literal (`0` for YES, `1` for NO)
- [ ] New server actions that set `outcome` in a DB write are reviewed against the schema definition

### Recommended tests

```ts
// Unit test — oracle assigns correct outcome
it("resolves YES (outcome=0) when milestone is met", async () => {
  // arrange: market with milestoneThreshold=1_000_000, poll with viewCount=1_000_001
  // act: resolveMarket(marketId)
  // assert: markets.outcome === 0
  // assert: YES position holders received payout
});

it("resolves NO (outcome=1) when milestone is not met at deadline", async () => {
  // arrange: market past resolvesAt, viewCount below threshold
  // act: resolveMarket(marketId)
  // assert: markets.outcome === 1
  // assert: NO position holders received payout
});

it("formatOutcome returns YES for 0 and NO for 1", () => {
  expect(formatOutcome(0)).toBe("YES");
  expect(formatOutcome(1)).toBe("NO");
});
```

### Warning signs to watch for

- A binary prediction market where the "winning" side shows 0 payout in the UI — likely an encoding inversion
- UI displaying resolved outcomes inconsistently across pages (some YES, some NO for the same market) — multiple encoding sites not in sync
- Admin manual resolve sending `outcome=1` to an endpoint that immediately runs payout — verify the literal before shipping

## Cross-References

- Related: `docs/solutions/logic-errors/` — other logic-error patterns in this codebase
- Schema source of truth: `src/db/schema.ts:104` — `outcome: integer; // 0=YES, 1=NO`
- Payout logic: `src/lib/services/payout.ts` — `distributePayout(tx, marketId, outcome)`
- Oracle entry point: `src/lib/oracle.ts` — `resolveMarket(marketId, prefetched?)`
- Format utility: `src/lib/format.ts` — `formatOutcome(outcome): "YES" | "NO"`
