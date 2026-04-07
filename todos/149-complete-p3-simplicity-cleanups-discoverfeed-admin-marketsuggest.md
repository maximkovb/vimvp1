---
name: Simplicity cleanups — DiscoverFeed, admin.ts, marketSuggestion
description: Multiple small YAGNI violations and unnecessary complexity in DiscoverFeed, admin server action, and marketSuggestion service
type: quality
status: pending
priority: p3
issue_id: "149"
tags: [code-review, simplicity, yagni, dead-code]
dependencies: []
---

## Problem Statement

Several small cleanups identified by code-simplicity-reviewer:

1. **`DiscoverFeed.tsx:33-35`** — `GridMarket extends FeedMarket {}` adds zero fields. Remove alias, use `FeedMarket[]` directly.
2. **`DiscoverFeed.tsx:99-105`** — double `.map()` when building `pollMap`. Replace with: `new Map(pollData.map((p) => [p.marketId, p]))`
3. **`DiscoverFeed.tsx:118-120`** — `closeSheet` is a one-liner called once. Inline it.
4. **`admin.ts:186`** — `const hours = resolutionHoursNum` is a pointless alias used once. Use `resolutionHoursNum` directly.
5. **`admin.ts:446`** — `const finalStatuses = ["resolved", "cancelled"]` allocated for a single inline check. Write: `if (market.status === "resolved" || market.status === "cancelled")`
6. **`admin.ts:73`** — `description: ""` in `fetchVideoStats` return is dead data, never read by callers.
7. **`marketSuggestion.ts:22,24,66,68`** — `suggestedTitle: null` and `subscriberCount: 0` are permanently stubbed. These fields exist from a removed LLM path and are never read by any caller. Remove from `MarketSuggestionResult` type and return value.

## Findings

Total LOC savings: ~40 lines across 3 files.

## Proposed Solutions

### Option A: Apply all 7 cleanups in one pass
- **Effort:** Small (~30 min)
- **Risk:** None — pure deletions and inlining

## Acceptance Criteria
- [ ] `GridMarket` interface removed from `DiscoverFeed.tsx`
- [ ] `pollMap` construction is a single `.map()` pass
- [ ] `closeSheet` inlined
- [ ] `hours` alias removed
- [ ] `finalStatuses` array inlined
- [ ] `description: ""` removed from `fetchVideoStats` return
- [ ] `suggestedTitle` and `subscriberCount` removed from `MarketSuggestionResult`

## Work Log
- 2026-04-06: Identified by code-simplicity-reviewer during ce:review
