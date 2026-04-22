---
title: "fix: Correct inverted YES/NO display and add shared outcome utility"
type: fix
status: active
date: 2026-04-19
---

# fix: Correct inverted YES/NO display and add shared outcome utility

## Overview

Six display locations across four files show the wrong YES/NO label because they compare
`outcome === 1` for YES when the schema defines `0=YES, 1=NO`. A user who bought NO sees
"YES" in their active portfolio position (and everywhere else outcome labels appear). This
plan fixes the inverted comparisons and introduces a single source of truth — a shared
`formatOutcome` utility — so the mapping can never silently drift again.

## Problem Frame

The DB schema stores `outcome` as an integer where `0=YES` and `1=NO` (documented in
`src/db/schema.ts` lines 106, 145, 173 and in AGENTS.md). Trade actions (`buyShares`,
`sellShares`) and most display components honour this convention. However, four files
contain the inverted pattern `outcome === 1 ? "YES" : "NO"`, which flips the label for
every bet a user has placed or every resolved market they inspect.

Because the stored data is correct (bets land in the right position), the bug is purely
visual and has no financial effect — but it erodes trust in the product immediately.

A prior incident of this exact bug is documented in
`docs/solutions/logic-errors/market-outcome-resolution-and-display.md`, which recommends
the shared-utility approach implemented here.

## Requirements Trace

- R1. Active portfolio positions display the side the user actually purchased.
- R2. Resolved positions and trade history display the correct YES/NO label.
- R3. Market cards show the correct outcome label on resolved markets.
- R4. The live trades feed on market pages shows correct outcome labels.
- R5. A single authoritative utility controls the `0=YES / 1=NO` mapping so future
  display components cannot silently diverge.

## Scope Boundaries

- No changes to stored data — positions and trades are stored correctly.
- No changes to trade execution logic — `buyShares` / `sellShares` are unaffected.
- No changes to oracle or resolution logic — that was fixed separately.
- No CI pipeline or ESLint plugin changes — utility + tests are the enforcement mechanism.

## Context & Research

### Relevant Code and Patterns

- `src/db/schema.ts` (lines 106, 145, 173) — canonical `0=YES, 1=NO` definition
- `src/lib/constants.ts` — existing home for project-wide constants; extend here
- `src/lib/__tests__/` — existing vitest test files (`lmsr.test.ts`, `projection.test.ts`) to follow
- Correct display pattern (reference): `src/components/BetSheet.tsx` (`outcome === 0 ? "YES" : "NO"`),
  `src/components/MarketHUD.tsx`, `src/components/PostTradeShareCard.tsx`,
  `src/components/ResolutionReveal.tsx` — all use `=== 0` for YES correctly

### Institutional Learnings

- `docs/solutions/logic-errors/market-outcome-resolution-and-display.md` — root-cause
  analysis of this exact bug class; recommends `Outcome` constant + `formatOutcome`
  utility + `formatOutcomeClass` helper as prevention. This plan implements that recommendation.

## Key Technical Decisions

- **Add to `src/lib/constants.ts`, not a new file**: The file already holds project-wide
  constants and is imported broadly. No new import paths needed.
- **`formatOutcome` returns a union literal `"YES" | "NO"`**: TypeScript narrows the
  return type, so callers cannot accidentally treat a broader `string` as safe to compare.
- **`isYes(outcome)` helper for className branches**: Color conditioning (green vs red)
  happens separately from text; a boolean helper keeps conditional class expressions
  readable without duplicating the magic number.
- **Tests go in `src/lib/__tests__/outcome.test.ts`**: Follows the existing test file
  convention in that directory; a failing test if the utility mapping ever changes.

## Open Questions

### Resolved During Planning

- **Is the stored data wrong too?** No — `src/lib/actions/trade.ts` (`buyShares`) passes
  `outcome` directly from the YES/NO button (`0=YES, 1=NO`) and stores it without
  transformation. The issue is display-only.
- **Should `formatOutcome` live in `src/lib/format.ts`?** `format.ts` already exists but
  handles number/date formatting. Outcome is domain-specific; `constants.ts` keeps it
  co-located with the `Outcome` constant itself.

### Deferred to Implementation

- Whether to also update AGENTS.md trading docs to reference `formatOutcome` as the
  required pattern — low priority, can be added as a follow-up comment.

## Implementation Units

- [x] **Unit 1: Add `Outcome` constant, `formatOutcome`, and `isYes` to `src/lib/constants.ts` with tests**

**Goal:** Create a single source of truth for the `0=YES / 1=NO` mapping. All display
components import from here instead of inlining magic numbers.

**Requirements:** R5

**Dependencies:** None

**Files:**
- Modify: `src/lib/constants.ts`
- Create: `src/lib/__tests__/outcome.test.ts`

**Approach:**
- Append to `constants.ts`:
  - `export const Outcome = { YES: 0, NO: 1 } as const;` — named values eliminate magic 0/1 in
    display and filter code.
  - `export function formatOutcome(outcome: number): "YES" | "NO"` — returns the correct
    label; throws (or returns a fallback) for unexpected values.
  - `export function isYes(outcome: number): boolean` — `outcome === Outcome.YES`; used
    for ternary className branches so callers don't repeat the magic comparison.
- Tests cover: `formatOutcome(0) === "YES"`, `formatOutcome(1) === "NO"`, both `isYes`
  cases, and unexpected input handling.

**Patterns to follow:**
- Existing constant exports in `src/lib/constants.ts` (no default exports, named only)
- Test structure from `src/lib/__tests__/lmsr.test.ts`

**Test scenarios:**
- Happy path: `formatOutcome(0)` → `"YES"`; `formatOutcome(1)` → `"NO"`
- Happy path: `isYes(0)` → `true`; `isYes(1)` → `false`
- Edge case: `formatOutcome` called with an unexpected integer (e.g. `2`, `-1`) — assert
  defined behavior (throw or return a sentinel) rather than silent `"NO"`

**Verification:**
- `src/lib/__tests__/outcome.test.ts` passes with no type errors
- `formatOutcome` is importable from `@/lib/constants` in a component file without error

---

- [x] **Unit 2: Replace all inverted `outcome === 1 ? "YES"` comparisons with `formatOutcome` / `isYes`**

**Goal:** Fix the visible bug — every display site now shows the correct side. Remove the
six inline inverted comparisons and replace them with calls to the utility from Unit 1.

**Requirements:** R1, R2, R3, R4

**Dependencies:** Unit 1

**Files:**
- Modify: `src/app/portfolio/page.tsx`
- Modify: `src/app/history/page.tsx`
- Modify: `src/components/MarketCard.tsx`
- Modify: `src/components/MarketLiveData.tsx`

**Approach:**

All six sites follow the same mechanical change: `=== 1` → call `formatOutcome` or `isYes`.

| File | Location | Current (wrong) | Replacement |
|------|----------|-----------------|-------------|
| `portfolio/page.tsx` | Active position badge className | `outcome === 1 ? "bg-green/…" : "bg-red/…"` | `isYes(outcome) ? "bg-green/…" : "bg-red/…"` |
| `portfolio/page.tsx` | Active position badge text | `outcome === 1 ? "YES" : "NO"` | `formatOutcome(outcome)` |
| `portfolio/page.tsx` | Resolved "Your Bet" column | `outcome === 1 ? "YES" : "NO"` | `formatOutcome(outcome)` |
| `portfolio/page.tsx` | Recent Trades outcome | `outcome === 1 ? "YES" : "NO"` | `formatOutcome(outcome)` |
| `history/page.tsx` | Trade badge className + text | `outcome === 1 ? …` (both) | `isYes` / `formatOutcome` |
| `MarketCard.tsx` | Resolved market label className + text | `outcome === 1 ? …` (both) | `isYes` / `formatOutcome` |
| `MarketLiveData.tsx` | Live trades text | `outcome === 1 ? "YES" : "NO"` | `formatOutcome(outcome)` |

Add `import { formatOutcome, isYes } from "@/lib/constants"` to each file that does not
already import from that path.

**Patterns to follow:**
- Correct usage already in `src/components/BetSheet.tsx` (reference pattern to match)
- `src/components/ResolutionReveal.tsx` for `isYes`-style color conditioning

**Test scenarios:**
- Happy path: Navigate to `/portfolio` as a user with a NO position (outcome=1 in DB) —
  assert the Side badge reads "NO" (red), not "YES".
- Happy path: Navigate to `/portfolio` as a user with a YES position (outcome=0) — assert
  badge reads "YES" (green).
- Happy path: Trade history page shows "YES" for outcome=0 trades and "NO" for outcome=1.
- Happy path: Resolved market card with `market.outcome = 0` shows "YES" label in green.
- Happy path: Resolved market card with `market.outcome = 1` shows "NO" label in red.
- Integration: Live trades feed on a market page shows correct labels for both outcomes.
- Edge case: A portfolio page with both YES and NO positions shows each correctly without
  cross-contamination.

**Verification:**
- No occurrences of `outcome === 1 ? "YES"` remain in the codebase (grep confirms)
- No occurrences of `outcome === 1 ? "text-green"` remain (grep confirms)
- The six display sites all render correct labels verified by manual review or snapshot tests
- TypeScript compiler reports no new errors

## System-Wide Impact

- **Interaction graph:** Pure display change — no callbacks, middleware, or server actions
  are modified. The DB query in `portfolio/page.tsx` is unchanged.
- **Error propagation:** None — the utility functions are synchronous and have no I/O.
- **State lifecycle risks:** None — no writes, no cache invalidation required. The fix
  takes effect on the next page load; no migration needed.
- **API surface parity:** `src/app/api/portfolio/route.ts` returns raw `outcome` integers
  and is unaffected; the API contract does not change.
- **Unchanged invariants:** Trade execution, position storage, and oracle resolution are
  explicitly not touched. The stored `outcome` values are correct; only the label rendering changes.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Missing a display site causes residual wrong labels | Grep for `outcome === 1 ? "YES"` and `outcome === 1 ? "text-green"` after the fix; plan lists all 6 known sites |
| `formatOutcome` import path breaks SSR (server component) | `src/lib/constants.ts` is a plain TS module with no browser APIs — safe to import in server components |
| A future component re-introduces the inverted inline pattern | The shared utility + test is the primary guard; the solutions doc is a secondary reference. Consider adding a grep script to `package.json` scripts for a quick audit |

## Sources & References

- Institutional learning: `docs/solutions/logic-errors/market-outcome-resolution-and-display.md`
- Schema definition: `src/db/schema.ts` lines 106, 145, 173
- Reference-correct display: `src/components/BetSheet.tsx`, `src/components/MarketHUD.tsx`,
  `src/components/PostTradeShareCard.tsx`, `src/components/ResolutionReveal.tsx`
- AGENTS.md: `outcome: 0 = YES, 1 = NO` in trading action documentation
