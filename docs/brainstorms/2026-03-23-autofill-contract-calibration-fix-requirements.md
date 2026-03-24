---
date: 2026-03-23
topic: autofill-contract-calibration-fix
---

# Auto-Fill Contract Calibration Fix

## Problem Frame

The auto-fill feature generates contract parameters (milestoneThreshold, bParameter, resolutionHours) after fetching video metadata. Two issues degrade market quality:

1. **Thresholds are too low**: milestoneThreshold is set at values the video will obviously reach given its current trajectory, producing markets where YES has 80–95%+ probability. Contracts feel predetermined. Root cause: the LLM anchors too heavily on current video velocity (which is already exceptional for a video an admin would select) instead of asking "what is genuinely hard for this video?" Even the 80–85th percentile channel instruction fails to account for a viral video that is already far above the channel average.

2. **Resolution windows lack variety**: The LLM consistently selects 72h because its resolution window logic is coupled to milestone hit probability. With the 85th-percentile calibration, most videos fall in the "P 10–20%" band, which always maps to 72h. The resolution window ends up being determined indirectly by threshold difficulty rather than by video/channel characteristics.

## Requirements

- R1. **Harder milestone thresholds**: Auto-filled milestoneThresholds must represent a genuine stretch for the specific video — a value the video might reach, but will not obviously blow past. A YES resolution should feel uncertain, not inevitable. The target individual-market YES probability is roughly **35–50%**. Crucially, when a video is already tracking significantly above its channel average, the threshold must reflect that elevated baseline, not the channel's historical median.

- R2. **Resolution window variety**: Resolution window selection must be decoupled from milestone hit probability and instead based on video and channel characteristics:
  - **24h**: already-viral video (12h+ old, tracking 3× the channel average or higher)
  - **48h**: young video (< 36h old) with strong above-average momentum
  - **72h**: standard default for most videos
  - **168h**: slow-burn content (music, tutorials), high-variance channels, or videos underperforming relative to channel average

- R3. **Algorithmic fallback recalibration**: The fallback formula in `contract.ts` uses a logarithmic projection and then applies conservative multipliers (0.6–0.8×), producing thresholds that are too easily exceeded. The fallback must apply a harder multiplier (≥ 1.5×) on the projected value, and its resolution window selection should follow the same characteristic-based logic as R2.

- R4. **Parlay viability floor**: The calibration target implies a YES parlay across 3–4 auto-generated markets should have at least a 1-in-10 chance of resolving all YES. This is consistent with individual market YES probability of ~40–50%.

## Success Criteria

- Auto-filled milestoneThresholds are not obviously exceeded by the video's current trajectory — admins can no longer immediately tell a market will resolve YES at fetch time.
- Resolution windows show meaningful variety in practice: 48h, 72h, and 168h all appear regularly; 24h appears for clearly viral picks.
- Over time, individual market YES resolution rate trends toward 35–55%, not 80%+.
- A 3–4 market YES parlay has at least a 1-in-10 chance of hitting.

## Scope Boundaries

- No changes to LMSR pricing math, payout logic, or resolution system.
- No new YouTube API calls beyond what is already fetched.
- Admin can still override all auto-filled values before submitting.
- No database schema changes.
- LLM reasoning text and risk badge UX remain unchanged.

## Key Decisions

- **Target ~40–50% YES probability per market**: Not the current 80–85th-percentile instruction (which isn't achieving its intended effect). The goal is balanced, interesting markets — not guaranteed YES outcomes.
- **Resolution window decoupled from threshold**: Video age, velocity relative to channel average, and content type determine the window — not the computed milestone hit probability.
- **Both paths need fixing**: LLM system prompt AND algorithmic fallback require recalibration. A fix to only the LLM path leaves the fallback producing easy contracts when the LLM is unavailable.

## Outstanding Questions

### Resolve Before Planning
- None

### Deferred to Planning
- [Affects R1][Technical] Should the prompt increase the explicit percentile target (e.g., to 90–95th) OR add a direct multiplier instruction (e.g., "threshold must be at least 2× the video's projected views at resolutionHours")? Both can achieve the calibration goal but behave differently for outlier videos.
- [Affects R1][Technical] Should the LLM be given the "current views / channel avg" ratio explicitly as a signal labeled "outperformance factor"? This might help it scale the threshold when a video is tracking far above the channel's norm.
- [Affects R2][Technical] Should the resolution window logic remain inside the LLM system prompt, or be computed algorithmically and passed to the LLM as a constraint? Algorithmic pre-computation is more predictable; keeping it in the prompt is more flexible.
- [Affects R3][Needs research] What multiplier range on the algorithmic fallback projection produces 35–50% YES probability in practice? Starting estimate: 1.5–2× the current projected value for medium/high risk tiers.

## Next Steps
→ `/ce:plan` for structured implementation planning
