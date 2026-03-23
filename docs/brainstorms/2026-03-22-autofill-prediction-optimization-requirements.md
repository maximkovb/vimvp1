---
date: 2026-03-22
topic: autofill-prediction-optimization
---

# Auto-Fill Prediction Optimization

## Problem Frame

The market creation auto-fill system generates contract parameters (milestoneThreshold, resolutionHours, bParameter) using a naive logarithmic projection formula. In practice, thresholds swing between too easy and too hard, and the same formula is applied to a MrBeast video and a niche channel equally. The root issues are:

1. The projection formula doesn't model different growth curve shapes (viral spike vs. slow burn)
2. Subscriber count is fetched but unused
3. There's no reasoning about qualitative context — video title, content category, publish timing
4. The target calibration is the projected mean, not the ~50th percentile — resulting in markets that don't have balanced trading odds

Admins cannot trust the auto-filled values and must manually correct them, which defeats the purpose of the system.

## Requirements

- R1. Replace the purely algorithmic `calculateContractRecommendations()` in `contract.ts` with an LLM-assisted pipeline that reasons over both quantitative and qualitative video signals.

- R2. The LLM receives a structured context object containing all available signals:
  - **Velocity:** current views, views/hour (currentViews ÷ videoAgeHours), video age in hours
  - **Channel strength:** subscriberCount, channelAvgViews, channelStdDev (from recent 10 videos)
  - **Engagement quality:** likeRatio (likes ÷ views), subscriberViewRatio (currentViews ÷ subscriberCount) — early signal of over/under-performance vs. subscriber base
  - **Publishing context:** day of week and hour (UTC) of publication — peak vs. off-peak timing
  - **Qualitative:** video title, channel name, video category (from YouTube API)

- R3. The LLM is explicitly prompted to set `milestoneThreshold` at the **~50th percentile** of projected outcome at the chosen `resolutionHours` — not the mean. This produces markets with balanced initial odds (roughly 50% probability of resolving YES).

- R4. The LLM returns structured JSON:
  ```
  {
    milestoneThreshold: number,
    resolutionHours: 24 | 48 | 72 | 168,
    bParameter: number,
    questionTypeRecommendation: "views" | "likes",
    reasoning: string,      // 2-4 sentence explanation shown to admin
    confidenceLevel: "high" | "medium" | "low"
  }
  ```

- R5. The admin market creation form displays the LLM's `reasoning` text alongside the auto-filled parameters, so admins understand why values were suggested and can make informed overrides.

- R6. If the LLM call fails (timeout, API error), the system falls back to the current algorithmic formula — no degraded UX for admins.

- R7. The `subscriberCount` signal (already fetched from YouTube API but currently unused) is incorporated into both the LLM context and the algorithmic fallback formula.

- R8. The `bParameter` is calibrated to prediction confidence: high-confidence predictions → lower b (tighter spread, ~50–75); low-confidence → higher b (~150–200). The LLM should reason about this, not use a fixed tier table.

## Success Criteria

- Resolved markets over time trend toward ~50% YES outcomes, not skewed strongly in either direction
- Admin overrides of auto-filled values decrease — fewer corrections needed
- The reasoning text is coherent and useful enough that admins can validate the suggestion without deep domain knowledge
- Fallback activates gracefully when LLM is unavailable; no form breakage

## Scope Boundaries

- Does not change market resolution logic, polling system, or payout calculations
- Does not add new YouTube API calls beyond what is already fetched (video stats, channel stats, recent video stats)
- LLM predictions are not stored in the database — each admin fetch recalculates fresh
- Reasoning text is admin-only; not shown to end users or traders
- Does not affect the `createMarket()` server action — parameters flow through the same form fields

## Key Decisions

- **~50% probability calibration:** Threshold is set at the median projected outcome, not the mean. Produces balanced markets with genuine two-sided trading.
- **LLM-assisted, not LLM-only:** Algorithmic fallback is retained. LLM adds qualitative reasoning on top of quantitative signals.
- **No historical calibration (yet):** Platform is early-stage with insufficient resolved market data. LLM reasons from first principles and channel signals. Calibration from resolved outcomes is deferred to a future iteration.
- **questionTypeRecommendation added:** LLM should suggest whether views or likes makes a more interesting/predictable market for the specific video — some content has high engagement relative to views.

## Dependencies / Assumptions

- Claude API key available in server environment
- LLM call is made server-side inside `fetchVideoMetadata()` (or a sibling function), not client-side
- YouTube API already returns `subscriberCount` — no additional API quota needed
- Video category field availability from YouTube API should be confirmed during planning

## Outstanding Questions

### Resolve Before Planning
- None

### Deferred to Planning
- [Affects R2][Technical] Does the YouTube API currently return `category` (categoryId / categoryName) in the existing video fetch, or does it require an additional `part=snippet` field?
- [Affects R4][Technical] Should the LLM call be made inside `fetchVideoMetadata()` directly, or as a separate `generateContractPrediction()` function that `fetchVideoMetadata()` calls?
- [Affects R5][Technical] Where in the admin form UI should the reasoning text be displayed — below the risk badge, in a tooltip/popover, or as an inline callout?
- [Affects R8][Needs research] What b-parameter range produces appropriately tight vs. wide LMSR spreads for the bet sizes expected on this platform?

## Next Steps
→ `/ce:plan` for structured implementation planning
