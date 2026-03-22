---
status: pending
priority: p3
issue_id: "016"
tags: [code-review, quality]
dependencies: []
---

# Code Cleanup: Remove Dead Code and Duplicate Constants

## Problem Statement

Several code elements are dead, unused, or duplicated: the `requireAdmin` / `isAdmin` helpers exist but are never called by admin actions; `YOUTUBE_API_BASE` is defined identically in two files; `"streak_bonus"` is a defined `CoinTransactionType` that is never inserted anywhere; `maxMarketMakerLoss` has a `numOutcomes` parameter that generalizes for a feature that doesn't exist (this is a binary-only market).

## Findings

- `src/lib/admin.ts`: `isAdmin()` and `requireAdmin()` — neither is imported or called by any admin action (all four actions do inline email comparison)
- `src/lib/actions/admin.ts:11` and `src/app/api/cron/poll-youtube/route.ts:7`: `const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"` — identical constant in two files
- `src/db/schema.ts:229`: `"streak_bonus"` in `CoinTransactionType` — never inserted anywhere; `economy.ts` writes a single `"daily_login"` entry for the combined base + streak amount
- `src/lib/lmsr.ts:119`: `maxMarketMakerLoss(b, numOutcomes = 2)` — `numOutcomes` parameter is unused in all callers (only the test file calls it, using the default)
- `src/lib/actions/economy.ts:39-43` and `54-58`: `lastRewardUTC` is constructed identically twice; can be extracted to a single variable

## Proposed Solutions

### Option 1: Targeted Removals

1. Delete `src/lib/admin.ts` (or keep if admin actions will be updated to use it per issue 011)
2. Extract `YOUTUBE_API_BASE` to `src/lib/youtube.ts` and import from both sites
3. Remove `"streak_bonus"` from `CoinTransactionType` in schema.ts
4. Remove `numOutcomes` parameter from `maxMarketMakerLoss`; hardcode `Math.LN2`
5. Extract `lastRewardUTC` construction in `economy.ts` to a shared variable

**Effort:** 1-2 hours | **Risk:** Low

## Recommended Action

Option 1. All are pure removals or trivial consolidations with no behavior change.

## Technical Details

**Affected files:**
- `src/lib/admin.ts` — evaluate deletion vs. adoption (coordinate with issue 011)
- `src/lib/actions/admin.ts:11` — remove YOUTUBE_API_BASE, import from lib/youtube.ts
- `src/app/api/cron/poll-youtube/route.ts:7` — same
- `src/db/schema.ts:229` — remove `"streak_bonus"`
- `src/lib/lmsr.ts:119` — remove numOutcomes parameter
- `src/lib/actions/economy.ts:39-58` — extract lastRewardUTC

## Acceptance Criteria

- [ ] `YOUTUBE_API_BASE` defined in exactly one place
- [ ] `"streak_bonus"` removed from CoinTransactionType (or added to the insert if it's a planned feature)
- [ ] `maxMarketMakerLoss` has no unused `numOutcomes` parameter
- [ ] `lastRewardUTC` computed once in claimDailyReward
- [ ] All existing tests still pass
- [ ] TypeScript compilation has no new errors

## Work Log

### 2026-03-22 - Discovery

**By:** Code simplicity reviewer (code review)
