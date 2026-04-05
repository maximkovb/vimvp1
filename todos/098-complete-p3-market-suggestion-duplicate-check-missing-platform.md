---
status: pending
priority: p3
issue_id: "098"
tags: [code-review, architecture, tiktok]
dependencies: []
---

# marketSuggestion Duplicate Check Missing Platform Predicate

## Problem Statement

`computeMarketSuggestion` in `src/lib/services/marketSuggestion.ts` checks for duplicate markets using only `eq(markets.videoId, videoId)`. The correct uniqueness constraint is `(videoId, platform)` — a YouTube video ID `dQw4w9WgXcQ` and a TikTok video with the same string ID would be treated as duplicates. In practice, YouTube and TikTok ID character sets don't overlap (YouTube: 11 base64url chars, TikTok: 15-20 digits), so this is not a real bug today. However, the logic is semantically incorrect and `platform` isn't even in `MarketSuggestionInput`, so it can't be fixed without a type change.

## Findings

From `src/lib/services/marketSuggestion.ts` lines 106–116:
```ts
const existing = await db
  .select({ id: markets.id })
  .from(markets)
  .where(
    and(
      eq(markets.videoId, videoId),
      // ← missing: eq(markets.platform, platform)
      or(eq(markets.status, "active"), eq(markets.status, "draft"))
    )
  )
  .limit(1);
```

Also: `computeMarketSuggestion` is currently only called from the YouTube-gated Phase 2 path (never called for TikTok markets), so TikTok markets never get duplicate warnings at all.

## Proposed Solutions

### Option A: Add `platform` to `MarketSuggestionInput` + Fix Query
```ts
export type MarketSuggestionInput = {
  videoId: string;
  platform: "youtube" | "tiktok" | "instagram";
  // ...rest unchanged
};
```

```ts
and(
  eq(markets.videoId, videoId),
  eq(markets.platform, platform),
  or(eq(markets.status, "active"), eq(markets.status, "draft"))
)
```

**Pros:** Correct invariant; enables duplicate detection for TikTok when suggestion is extended
**Effort:** Small
**Risk:** Low — callers must pass `platform`, which they all know at call time

## Recommended Action

Option A. Low-risk correctness fix to prevent future issues when TikTok suggestion support is added.

## Technical Details

- **Affected file:** `src/lib/services/marketSuggestion.ts`
- **Related:** todo #089 — when TikTok suggestion support is added, this fix will be needed

## Acceptance Criteria

- [ ] `MarketSuggestionInput` includes `platform` field
- [ ] Duplicate check query includes `eq(markets.platform, platform)`
- [ ] All callers of `computeMarketSuggestion` pass `platform`

## Work Log

- 2026-03-29: Identified by architecture-strategist during TikTok integration code review
