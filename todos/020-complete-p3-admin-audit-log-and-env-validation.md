---
status: pending
priority: p3
issue_id: "020"
tags: [code-review, quality, security]
dependencies: []
---

# Add Admin Audit Log, DATABASE_URL Validation, and Minor Quality Fixes

## Problem Statement

Three small but related improvements: (1) admin actions that trigger financial operations (cancel triggering refunds, manualResolve triggering payouts) have no audit trail; (2) `DATABASE_URL!` non-null assertion produces an opaque crash rather than a helpful startup error; (3) `previewTrade` fires on every keystroke with no debounce, hitting the database on each character typed.

## Findings

**Admin audit log missing:**
- `src/lib/actions/admin.ts`: `cancelMarket` and `manualResolve` trigger financial operations (refunds, payouts affecting potentially thousands of coins) with no record of who triggered them or when
- `coinTransactions` ledger records user-facing events but not the administrative trigger
- If a payout is disputed, there is no audit record

**DATABASE_URL non-null assertion:**
- `src/db/index.ts:5`: `process.env.DATABASE_URL!` — if DATABASE_URL is undefined at runtime, Pool receives `undefined` and produces a cryptic connection error rather than a clear startup message

**previewTrade on every keystroke:**
- `src/components/TradePanel.tsx` — `handleAmountChange` calls `previewTrade` (a server action, DB round-trip) on every character typed in the amount field
- At 300ms typing speed, a user typing "1000" triggers 4 server actions
- Under load, this creates unnecessary DB pressure

## Proposed Solutions

**Fix 1 — DATABASE_URL validation:**
```typescript
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL environment variable is not set");
const pool = new Pool({ connectionString });
```

**Fix 2 — previewTrade debounce:**
Add a 400ms debounce to the `handleAmountChange` handler in `TradePanel.tsx`:
```typescript
const debouncedPreview = useMemo(() => debounce(handleAmountChange, 400), []);
```
Or move the LMSR calculation client-side (the math is pure and has no secrets).

**Fix 3 — Admin audit log:**
Create a simple `adminActions` table and insert a row at the start of each admin mutation:
```sql
CREATE TABLE admin_actions (
  id text PRIMARY KEY,
  admin_user_id text NOT NULL REFERENCES users(id),
  action text NOT NULL, -- 'cancel_market', 'manual_resolve', 'publish_market', 'create_market'
  target_id text,
  payload jsonb,
  created_at timestamp NOT NULL DEFAULT NOW()
);
```

**Effort (Fix 1):** 5 minutes | **Effort (Fix 2):** 30 minutes | **Effort (Fix 3):** 2 hours
**Risk:** Low for all

## Technical Details

**Affected files:**
- `src/db/index.ts:5` — DATABASE_URL validation
- `src/components/TradePanel.tsx` — debounce previewTrade
- `src/db/schema.ts` — add adminActions table (if pursuing Fix 3)
- `src/lib/actions/admin.ts` — insert audit row in each action (if pursuing Fix 3)
- `drizzle/` — migration for adminActions table

## Acceptance Criteria

- [ ] Missing `DATABASE_URL` produces a clear startup error message, not a cryptic connection failure
- [ ] `previewTrade` is debounced — at most 1 server call per 400ms of typing
- [ ] (Optional for now) Admin actions create an audit record with who triggered what and when

## Work Log

### 2026-03-22 - Discovery

**By:** Architecture strategist + Security sentinel + Code simplicity reviewer (code review)
