---
status: pending
priority: p3
issue_id: "035"
tags: [code-review, performance, dry, maintainability]
dependencies: []
---

# Mean/StdDev of `recentViewCounts` Computed Twice — `admin.ts` and `contract.ts`

## Problem Statement

`admin.ts:117-127` computes the mean and standard deviation of `recentViewCounts` to populate `videoContext.channelAvgViews` and `videoContext.channelStdDev`. `calculateConfidence()` in `contract.ts:34-46` recomputes mean and standard deviation from the same array to calculate `varianceScore`. This is a 20-iteration double-loop over a 10-element array. It's negligible today but is a code smell: if `maxResults` is raised, this doubles to 40+ iterations per admin fetch.

## Findings

- `admin.ts:117-127` — inline mean/stdDev computation for `VideoContext`
- `contract.ts:34-46` — `calculateConfidence()` recomputes mean/stdDev internally from `recentViewCounts`

## Proposed Solutions

### Option 1: Accept pre-computed mean and stdDev as optional params to `calculateConfidence` (Recommended)

```typescript
export function calculateConfidence(
  videoAgeHours: number,
  recentViewCounts: number[],
  precomputedMean?: number,
  precomputedStdDev?: number,
): number {
  const mean = precomputedMean
    ?? (recentViewCounts.reduce((a, b) => a + b, 0) / recentViewCounts.length);
  // ...
}
```

**Pros:** Eliminates double computation when called after inline calculation
**Cons:** Slightly longer signature
**Effort:** Small  **Risk:** Low

---

### Option 2: Remove the inline computation from `admin.ts` and rely on `calculateConfidence`'s internals

Expose `mean` and `stdDev` as a separate utility function so both callers can share.

**Effort:** Small  **Risk:** Low

## Acceptance Criteria

- [ ] `recentViewCounts` is only iterated once per `fetchVideoMetadata` call for mean/stdDev
- [ ] No behavioral change — same `confidence` value for the same inputs

## Work Log

### 2026-03-23 - Discovery

**By:** Performance Oracle (code review agent)
