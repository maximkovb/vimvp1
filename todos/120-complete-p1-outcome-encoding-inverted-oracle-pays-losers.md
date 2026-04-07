---
name: Outcome encoding inverted — oracle pays losing side
description: oracle.ts assigns outcome=1 when milestone is hit, but schema defines 1=NO; every auto-resolved YES market pays NO holders
type: bug
status: pending
priority: p1
issue_id: "120"
tags: [code-review, architecture, data-integrity, lmsr, payout]
dependencies: []
---

## Problem Statement

`oracle.ts:43` assigns `outcome = 1` when the metric meets or exceeds the milestone threshold. The schema comment at `schema.ts:104` is unambiguous: `// null until resolved; 0=YES, 1=NO`. When a market's milestone is hit (a YES event), the oracle stores `outcome=1`, which is the NO outcome. `distributePayout` then pays positions with `outcome=1` — the NO holders — while YES holders receive nothing.

**This is a silent, complete inversion of payout logic for every auto-resolved market.**

**Why:** The `?` branch was coded backwards — `>= threshold ? 1 : 0` when it should be `>= threshold ? 0 : 1`.

**How to apply:** Fix immediately before any more markets auto-resolve. Check DB for already-resolved markets to assess data remediation needed.

## Findings

- **`src/lib/oracle.ts:43`**: `const outcome = metric !== null && metric >= market.milestoneThreshold ? 1 : 0;` — should be `? 0 : 1`
- **`src/components/AdminMarketActions.tsx:77`**: `manualResolve(marketId, 1)` for "Resolve YES" — should be `0`
- **`src/components/AdminMarketActions.tsx:88`**: `manualResolve(marketId, 0)` for "Resolve NO" — should be `1`
- **`src/components/MarketCard.tsx:71,74`**: `outcome === 1 ? "YES" : "NO"` — inverted vs schema
- **`src/components/MarketLiveData.tsx:276`**: `trade.outcome === 1 ? "YES" : "NO"` — inverted
- **`src/app/history/page.tsx:85,90`**: `t.trade.outcome === 1 ? "YES" : "NO"` — inverted
- **`src/app/portfolio/page.tsx:168,173,258`**: `p.position.outcome === 1 ? "YES" : "NO"` — inverted

Correct (schema-aligned, `0=YES`) components: `ResolutionReveal.tsx:33`, `ResolutionShareCard.tsx:28`, `PostTradeShareCard.tsx:32`, `BetSheet.tsx:127`, `TradePanel.tsx:21`.

## Proposed Solutions

### Option A: Fix oracle + admin actions + 4 inconsistent components (Recommended)
Fix oracle to `? 0 : 1`. Fix `AdminMarketActions` to pass 0 for YES and 1 for NO. Fix 4 UI files to use `outcome === 0 ? "YES" : "NO"`. This aligns everything with the schema comment.
- **Effort:** Small (7 one-line changes)
- **Risk:** Forward-looking fix only. Past resolved markets in DB have wrong outcome stored — requires a data audit/migration for affected markets.

### Option B: Flip the schema convention
Change schema comment to `0=NO, 1=YES` and fix the majority-correct components. More changes needed.
- **Effort:** Medium
- **Risk:** Higher — more files to touch, easy to miss one.

## Recommended Action
Option A. Run the one-liner fix first, then query DB for `SELECT id, title, outcome FROM markets WHERE status='resolved'` to enumerate affected markets and manually assess if data remediation is needed.

## Technical Details
- **Affected files:** `oracle.ts:43`, `AdminMarketActions.tsx:77,88`, `MarketCard.tsx:71,74`, `MarketLiveData.tsx:276`, `history/page.tsx:85,90`, `portfolio/page.tsx:168,173,258`
- **DB impact:** All auto-resolved markets paid wrong side. Manual resolves via admin UI also inverted.

## Acceptance Criteria
- [ ] `oracle.ts` assigns `outcome=0` when metric >= threshold, `outcome=1` when not
- [ ] `AdminMarketActions` passes `0` for YES, `1` for NO
- [ ] All display components consistently use `outcome === 0 ? "YES" : "NO"`
- [ ] DB audit query run to enumerate past incorrectly resolved markets
- [ ] Existing tests updated (`lmsr.test.ts`, `contract.test.ts`)

## Work Log
- 2026-04-06: Identified by architecture-strategist and kieran-typescript-reviewer during ce:review
