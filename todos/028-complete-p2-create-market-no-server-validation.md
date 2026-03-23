---
status: pending
priority: p2
issue_id: "028"
tags: [code-review, security, validation, lmsr]
dependencies: []
---

# `createMarket` — `bParameter` and `milestoneThreshold` Have No Server-Side Validation

## Problem Statement

`createMarket()` in `src/lib/actions/admin.ts` reads `bParameter` and `milestoneThreshold` from `FormData` and uses them directly without server-side range validation. Client-side HTML constraints (`min="1"`, `max="1000"`) are bypassed by direct FormData POSTs. `bParameter = 0` causes LMSR divide-by-zero in `allPrices()` and `price()`, potentially storing `Infinity` or `NaN` in trade cost and position records. `BigInt(milestoneThreshold)` throws an unhandled `SyntaxError` on malformed input (e.g., `"abc"` or `"1e308"`), producing an uncaught 500 instead of a clean error response.

## Findings

- `admin.ts:203` — `const b = parseFloat(bParameter || "100")` — no range check
- `admin.ts:213` — `milestoneThreshold: BigInt(milestoneThreshold)` — throws `SyntaxError` on malformed input
- `page.tsx:299-300` — `min="1" max="1000"` on input — client-only, bypassed by direct POST
- `src/lib/lmsr.ts` — LMSR functions use `b` as denominator; `b=0` → `Infinity`/`NaN`
- Zod caps `milestoneThreshold` at `10_000_000_000` in `prediction.ts:125` but that only covers LLM output

## Proposed Solutions

### Option 1: Add explicit server-side validation in `createMarket` (Recommended)

```typescript
// bParameter validation
const b = parseFloat(bParameter || "100");
if (!isFinite(b) || b < 1 || b > 1000) {
  return { error: "bParameter must be between 1 and 1000" };
}

// milestoneThreshold validation
let thresholdBigInt: bigint;
try {
  thresholdBigInt = BigInt(milestoneThreshold);
} catch {
  return { error: "Invalid milestone threshold" };
}
if (thresholdBigInt < 1n || thresholdBigInt > 10_000_000_000n) {
  return { error: "Milestone threshold must be between 1 and 10,000,000,000" };
}
```

**Pros:** Prevents LMSR corruption; clean error response instead of 500; mirrors Zod schema bounds
**Cons:** None
**Effort:** Small
**Risk:** Low

---

### Option 2: Parse all FormData fields with Zod

Define a `CreateMarketFormSchema` and parse the entire FormData at the top of `createMarket`. Returns structured errors for all fields at once.

**Pros:** Comprehensive; self-documenting schema
**Cons:** More boilerplate
**Effort:** Small
**Risk:** Low

## Recommended Action

Option 1 immediately (surgical fix). Option 2 in a follow-up as a quality improvement.

## Technical Details

**Affected files:**
- `src/lib/actions/admin.ts:200-215`

## Acceptance Criteria

- [ ] `createMarket` with `bParameter=0` returns `{ error: "..." }`, not a 500 or corrupted DB record
- [ ] `createMarket` with `bParameter=NaN` (sent as empty string) returns `{ error: "..." }`
- [ ] `createMarket` with `milestoneThreshold="abc"` returns a clean error, not an unhandled exception
- [ ] `createMarket` with `milestoneThreshold="99999999999999"` (above 10B) returns a range error
- [ ] Valid submissions continue to work normally

## Work Log

### 2026-03-23 - Discovery

**By:** Security Sentinel + TypeScript Reviewer (code review agents)
