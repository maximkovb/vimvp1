---
status: pending
priority: p1
issue_id: "089"
tags: [code-review, tiktok, agent-native, api, parity]
dependencies: []
---

# /api/admin/market-suggestion YouTube-Only: Agent Cannot Get TikTok Suggestions

## Problem Statement

The `POST /api/admin/market-suggestion` endpoint (used by agents to get AI-generated market parameters) is wired through `computeMarketSuggestion` in `src/lib/services/marketSuggestion.ts`, which fetches channel analytics from the YouTube API. For TikTok videos, this always fails silently — returning `null` contract and no suggested title — making it useless for agent-based TikTok market creation.

## Findings

From `src/lib/services/marketSuggestion.ts`:
- The function validates `channelId` against `YOUTUBE_CHANNEL_ID_RE`
- It then fetches subscriber count and recent uploads from the YouTube Data API
- TikTok videos don't have a YouTube channelId — the function falls through to the channel-fetch-failed path and returns `{ contract: null, suggestedTitle: null, ... }`
- The admin page correctly guards against this (`if (statsResult.platform !== "tiktok" && statsResult.channelId)`) — but the API endpoint has no equivalent guard and returns a misleading null response

## Proposed Solutions

### Option A: Add Platform Awareness to the API Endpoint
In `POST /api/admin/market-suggestion`, detect if the input is for a TikTok video and return an appropriate "suggestion not available" response with a clear reason:

```ts
if (input.platform === "tiktok") {
  return NextResponse.json({
    contract: null,
    suggestedTitle: null,
    videoAgeHours: input.videoAgeHours,
    subscriberCount: 0,
    channelAvgViews: input.viewCount,
    duplicateWarning: false,
    unavailableReason: "Market suggestions are not available for TikTok videos. Use algorithmic defaults."
  });
}
```

**Pros:** Clear signal to agents; no silent failure
**Effort:** Small
**Risk:** None

### Option B: Implement TikTok-specific Suggestion Logic
Use TikAPI to fetch the creator's recent post statistics (if available in the API plan) and compute algorithmic suggestions, similar to the YouTube channel analytics path.

**Pros:** Full parity
**Cons:** Requires TikAPI plan that supports creator analytics
**Effort:** Large
**Risk:** Medium (TikAPI capability uncertainty)

### Option C: Extend `computeMarketSuggestion` to Accept Platform
Add `platform` to `MarketSuggestionInput` and short-circuit with algorithmic fallback (no channel fetch) for TikTok:

```ts
if (input.platform === "tiktok") {
  // Skip YouTube channel fetch; go straight to algorithmic contract
  const contract = calculateContractRecommendations(...);
  return { contract, suggestedTitle: null, ... };
}
```

**Pros:** Returns useful contract even without AI title
**Effort:** Small-medium
**Risk:** Low

## Recommended Action

Option C as a practical fix — skip channel fetch for TikTok and return algorithmic contract recommendations. Pair with Option A's `unavailableReason` for agent clarity.

## Technical Details

- **Affected files:** `src/lib/services/marketSuggestion.ts`, `src/app/api/admin/market-suggestion/route.ts`
- **Key type:** Add `platform?: "youtube" | "tiktok" | "instagram"` to `MarketSuggestionInput`

## Acceptance Criteria

- [ ] API returns a non-null `contract` for TikTok videos (algorithmic fallback)
- [ ] Response includes `unavailableReason` or similar when AI suggestion is not possible
- [ ] Agents can use the contract recommendation to proceed with TikTok market creation
- [ ] YouTube suggestion path unchanged

## Work Log

- 2026-03-29: Identified by agent-native-reviewer agent during TikTok integration code review
