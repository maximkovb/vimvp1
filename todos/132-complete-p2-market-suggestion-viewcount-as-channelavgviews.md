---
name: marketSuggestion passes viewCount as channelAvgViews — inflated floor for viral videos
description: computeMarketSuggestion uses the video's own viewCount as channelAvgViews, producing an artificially hard milestone for new channels
type: bug
status: pending
priority: p2
issue_id: "132"
tags: [code-review, architecture, calibration, market-suggestion]
dependencies: []
---

## Problem Statement

`src/lib/services/marketSuggestion.ts:62` calls `calculateContractRecommendations(confidence, viewCount, videoAgeHours, [], viewCount)`. The 5th argument is `channelAvgViews`. Passing `viewCount` (the current video's views) as the channel average inflates the floor for new channels with a viral first video — `computeExpectedOutcome` then produces an artificially high expected outcome, making the milestone harder than warranted. The documented correct fallback when no channel data is available is `0`, which degrades to velocity-only projection.

## Findings

- **`src/lib/services/marketSuggestion.ts:62`**: `viewCount` passed as `channelAvgViews`
- **`src/lib/calibration.ts:68`**: comment documents `channelAvgViews = 0` as the correct fallback

## Proposed Solutions

### Option A: Pass 0 as channelAvgViews when no channel data available
```ts
const contract = calculateContractRecommendations(confidence, viewCount, videoAgeHours, [], 0);
```
- **Effort:** Tiny (1 argument change)
- **Risk:** Will produce lower (easier) milestones for new channels — more accurate

## Acceptance Criteria
- [ ] `channelAvgViews` defaults to `0` when no channel history is available
- [ ] Milestones for new channels with viral videos are more reasonable

## Work Log
- 2026-04-06: Identified by architecture-strategist during ce:review
