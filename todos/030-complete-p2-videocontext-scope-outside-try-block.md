---
status: pending
priority: p2
issue_id: "030"
tags: [code-review, architecture, readability]
dependencies: []
---

# `VideoContext` Assembled Outside try Block — Misleading Scope for LLM-Only Data

## Problem Statement

`videoContext` is assembled at lines 132–144 of `admin.ts` in the outer scope of the inner try/catch. When the LLM fails and the fallback runs, this object is dead code — built and immediately discarded. More importantly, a reader must know to look at both paths to understand that `videoContext` is only consumed by the LLM path. The current placement implies it is shared state, obscuring the LLM-only nature of the data. This also makes the catch branch harder to reason about and creates a subtle maintenance hazard: any throw added between lines 130 and 147 will be caught by the inner catch and silently produce an algorithmic recommendation.

## Findings

- `admin.ts:132-144` — `videoContext` constructed before `try`
- `admin.ts:130` — `confidence` correctly placed before `try` (needed by catch branch)
- `admin.ts:147` — `try { contract = await generateContractPrediction(videoContext); }`
- `admin.ts:151-156` — catch uses `confidence`, not `videoContext`

## Proposed Solutions

### Option 1: Move `videoContext` construction inside the `try` block (Recommended)

```typescript
const confidence = calculateConfidence(videoAgeHours, recentViewCounts);

try {
  const videoContext: VideoContext = {
    videoTitle: item.snippet.title,
    channelName: item.snippet.channelTitle,
    videoCategory: categoryId,
    videoAgeHours,
    publishedDayOfWeek: new Date(publishedAt).getUTCDay(),
    publishedHourUTC: new Date(publishedAt).getUTCHours(),
    currentViews: viewCount,
    currentLikes: likeCount,
    subscriberCount,
    channelAvgViews: mean,
    channelStdDev: stdDev,
  };
  contract = await generateContractPrediction(videoContext);
} catch {
  contract = calculateContractRecommendations(
    confidence, viewCount, videoAgeHours, recentViewCounts
  );
}
```

**Pros:** Makes LLM-only data scope explicit; removes dead code in catch path; reduces maintenance hazard
**Cons:** None
**Effort:** Small
**Risk:** Low

## Recommended Action

Option 1. Two-line change (move the `const videoContext` block and its closing brace).

## Technical Details

**Affected files:**
- `src/lib/actions/admin.ts:130-157`

## Acceptance Criteria

- [ ] `videoContext` construction is inside the `try` block
- [ ] `confidence` computation remains outside (before the `try`)
- [ ] No behavior change — same output for both LLM success and LLM failure paths
- [ ] Code review shows `confidence` and `videoContext` in clearly separated scopes

## Work Log

### 2026-03-23 - Discovery

**By:** Architecture Strategist (code review agent)
