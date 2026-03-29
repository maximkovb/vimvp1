---
title: "fix: Auto-Fill Contract Calibration — Harder Thresholds & Varied Resolution Windows"
type: fix
status: completed
date: 2026-03-23
origin: docs/brainstorms/2026-03-23-autofill-contract-calibration-fix-requirements.md
---

# fix: Auto-Fill Contract Calibration — Harder Thresholds & Varied Resolution Windows

## Overview

The auto-fill system generates contract parameters (milestoneThreshold, resolutionHours, bParameter) after an admin fetches a YouTube video. Two compounding problems make every generated market trivial:

1. **Thresholds are too low** — markets resolve YES 80–95%+ of the time. Despite the system prompt instructing the LLM to target the "80–85th percentile," the LLM anchors too heavily on current video velocity and sets thresholds below what the video will obviously reach. The institutional learning (`docs/solutions/integration-issues/anthropic-claude-api-nextjs-server-action.md`) confirms this class of calibration error was encountered during the original implementation.

2. **Resolution windows are always 72h** — the LLM's resolution window logic is coupled to milestone hit probability. Since the threshold (supposedly at 85th percentile) puts most videos in the "P 10–20%" bucket, every market maps to the 72h window. In practice, 72h is the default for nearly every auto-filled market.

Target outcome: individual market YES probability of roughly 35–50%, producing meaningful uncertainty. A 3-market YES parlay should have at least a 1-in-10 chance of resolving.

## Problem Statement

### Why thresholds come out too low

When an admin fetches a video, they are typically selecting a video that is already performing exceptionally relative to its channel. The LLM is given:
- `channelAvgViews`: the historical mean (e.g., 500K)
- `currentViews`: already exceptional (e.g., 1M at 12 hours)
- `views/hour`: high velocity

Even if the LLM "targets the 85th percentile," it uses the channel distribution as a loose anchor but is pulled toward current velocity when reasoning about future views. The result is a threshold like 1.5M — which the video will trivially exceed by 72h when it reaches 4M+.

The root fix: give the LLM an explicit algorithmic projection of where the video will land at each resolution window, and instruct it to set the threshold **above** that projection.

### Why resolution windows are always 72h

The system prompt logic:
```
P < 10%: 168h
P 10-20%: 72h
P ≥ 20%: 48h
```

The LLM infers "channel hit probability" from `channelConsistencyPct` and the views ratio — this is never explicitly computed. With an 85th-percentile threshold, most videos implicitly land in "P 10–20%", producing 72h. The window selection must be decoupled from the threshold difficulty.

## Proposed Solution

### Two coordinated changes

**1. System prompt + user prompt in `src/lib/prediction.ts`:**
- Add an explicit server-side projection to `buildUserPrompt()`: compute `projectedViews` at each candidate resolution window (24h, 48h, 72h, 168h) using the same logarithmic formula as the algorithmic fallback. Pass these as labeled lines in the user prompt so the LLM has concrete anchors.
- Add an explicit `outperformanceFactor` = `currentViews / channelAvgViews` signal so the LLM knows when a video is already an outlier.
- Update `SYSTEM_PROMPT`: change the calibration goal from abstract "80–85th percentile" to a concrete relative instruction — threshold should be **at least 1.5× the projected value at the chosen window** for a well-performing video, adjusted down toward 1.2× for uncertain/high-variance channels. This matches the 35–50% YES probability target.
- Decouple resolution window selection from hit probability. Base it on **video characteristics**:
  - **24h**: video is 12h+ old AND tracking ≥ 3× channel average (already viral)
  - **48h**: video is < 36h old AND tracking ≥ 1.5× channel average (strong early momentum)
  - **168h**: slow-burn signals (music/tutorial category, channelConsistency < 30%, or video underperforming relative to channel avg)
  - **72h**: default for everything else

**2. Algorithmic fallback in `src/lib/contract.ts`:**
- Apply harder multipliers on the projected value: Low tier ≥ 2.0×, Medium tier ≥ 1.5×, High tier ≥ 1.2×
- Adopt the same characteristic-based resolution window logic as the LLM (24h/48h/72h/168h) so both paths behave consistently
- Add `channelAvgViews` as an optional parameter to `calculateContractRecommendations()` to enable the outperformance-factor-based `resolveWindow()` logic; fall back to current behavior when unavailable. (`subscriberCount` is not needed — `outperformanceFactor = currentViews / channelAvgViews`.)

**3. Tests in `src/lib/__tests__/contract.test.ts` (new file):**
- Unit tests for `calculateContractRecommendations()`, `calculateConfidence()`, `assignRiskTier()`, `roundToClean()`
- Verify the harder multipliers produce thresholds well above projected baseline
- Cover resolution window selection across the characteristic-based cases

## Technical Considerations

- **Zod v4**: Project uses `zod ^4.3.6`. The existing `import { z } from "zod"` is the correct v4 pattern. Do not introduce `z.infer<>` patterns from Zod v3 docs.
- **LLM tool schema**: `bParameter` min/max are enforced in the Zod clamp (`Math.max(50, Math.min(200, v))`). No schema change needed for the calibration fix.
- **`buildUserPrompt()` is a pure function** — compute projected views inside `buildUserPrompt()` directly from the existing `VideoContext` fields (`currentViews`, `videoAgeHours`). This avoids changing the `VideoContext` interface or the call site in `admin.ts`.
- **Fallback consistency**: The `contract.ts` fallback must mirror the new resolution window logic; a mismatch would produce different behavior depending on whether the LLM is available.
- **`resolutionHours` is a `<select>` with fixed options** (24/48/72/168) — the LLM enum and Zod schema already enforce this; no form change needed.
- **No new YouTube API calls** — all signals needed (videoAgeHours, currentViews, channelAvgViews) are already in `VideoContext` / `admin.ts`.
- **Model**: Pinned to `claude-sonnet-4-6` via `ANTHROPIC_MODEL`. The calibration prompts should be tested against this model specifically.

## System-Wide Impact

- **Interaction graph**: Changes are isolated to `src/lib/prediction.ts` (LLM prompt) and `src/lib/contract.ts` (fallback formula). `admin.ts` calls both but its interface does not change. `page.tsx` consumes `contract.resolutionHours` — already correctly applied on line 94; no UI change needed.
- **Error propagation**: LLM fallback chain is unchanged — any throw from `generateContractPrediction` still routes to `calculateContractRecommendations`. The harder fallback multipliers are just arithmetic; no new error surface.
- **State lifecycle risks**: These are read-only generation functions — no DB state is touched until `createMarket` is submitted. Admin can still override all auto-filled values.
- **API surface parity**: `calculateContractRecommendations()` may gain optional new parameters (`subscriberCount`, `channelAvgViews`) for the outperformance factor; callers in `admin.ts` already have these values from the analytics fetch. Ensure both the LLM path and the fallback path are consistent in how they use the outperformance factor.

## Acceptance Criteria

- [ ] Auto-filled `milestoneThreshold` is visibly above the video's simple extrapolated trajectory — a video tracking toward 4M views should get a threshold of 5M+, not 1.5M.
- [ ] Resolution windows show variety across a sample of fetched videos: 48h and 168h appear regularly, not only 72h.
- [ ] 24h is only recommended when the video is clearly already viral (12h+ old, tracking ≥ 3× channel average).
- [ ] The algorithmic fallback (when LLM is unavailable) applies a ≥ 1.5× multiplier on projected views for medium risk and ≥ 2.0× for low risk.
- [ ] Fallback resolution window logic matches the LLM's new characteristic-based logic.
- [ ] New unit tests in `src/lib/__tests__/contract.test.ts` cover `calculateContractRecommendations()` (all three tiers), `calculateConfidence()`, `assignRiskTier()`, and `roundToClean()`.
- [ ] All existing tests (`src/lib/__tests__/lmsr.test.ts`) continue to pass.
- [ ] The system prompt no longer references "80–85th percentile" as the sole calibration instruction.
- [ ] Admin override workflow is unchanged — all form fields remain editable before submission.

## Success Metrics

- Individual market YES resolution rate trends toward 35–55% over the next 20+ resolved markets.
- A 3-market YES parlay has at least ~10% probability of hitting.
- Resolution windows in admin market list show variety (not exclusively 72h).

## Dependencies & Risks

- **Risk: Over-correction** — multiplying projections by 2× could set thresholds that never resolve YES. Mitigate: the admin can always override, and the reasoning text explains the logic. Start at 1.5–2× and adjust after ~20 markets.
- **Risk: LLM ignoring updated instructions** — prompt engineering is not deterministic. Mitigate: include the explicit numerical projection in the user prompt as an anchor; the LLM is less likely to ignore a concrete number than a percentile instruction.
- **Risk: Outperformance factor causing extreme thresholds for mega-channels** — if a channel has 50M avg views, a 2× projection could be absurd. Mitigate: cap the outperformance multiplier at 3× in the fallback and instruct the LLM to cap at 3× outperformance-adjusted projection.
- **Dependency: `ANTHROPIC_MODEL` env var** — calibration should be verified against `claude-sonnet-4-6`. Set explicitly in `.env.local` during testing.

## Implementation Notes

### `buildUserPrompt()` additions (prediction.ts)

Add these labeled lines to the prompt after the channel section:

```
Algorithmic projection (logarithmic growth from current velocity):
  - At 24h: {projected24h} views
  - At 48h: {projected48h} views
  - At 72h: {projected72h} views
  - At 168h: {projected168h} views
Outperformance factor: {outperformanceFactor}x channel average
```

Compute inside `buildUserPrompt()`:
```typescript
function projectViews(currentViews: number, videoAgeHours: number, targetHours: number): number {
  const safeAge = Math.max(videoAgeHours, 0.1);
  return Math.round(currentViews * (Math.log(targetHours + 1) / Math.log(safeAge + 1)));
}
// outperformanceFactor — guard against channelAvgViews = 0
const outperformanceFactor = ctx.channelAvgViews > 0
  ? +(ctx.currentViews / ctx.channelAvgViews).toFixed(2)
  : 1.0;
```

### Updated SYSTEM_PROMPT calibration goal

Replace the current "80–85th percentile" GOAL with:

```
GOAL: Set milestoneThreshold at a level that is genuinely challenging — roughly 1.5–2× the
algorithmic projection provided in the prompt for the chosen resolution window. This produces
markets where YES has a real chance of NOT resolving (35–50% YES rate is the target).
- Do NOT set threshold below the algorithmic projection — that produces trivially easy markets.
- For high-confidence/consistent channels: 1.8–2.0× the projection.
- For low-confidence/chaotic channels: 1.2–1.5× the projection.
- Cap the multiplier at 3× to avoid absurd thresholds for mega-channels.
```

### Updated resolution window rule

Replace the current "rarity-first" resolution window section with:

```
RESOLUTION WINDOW (choose based on video characteristics, NOT milestone hit probability):
- 24h: video is ≥12h old AND outperformanceFactor ≥ 3.0 (already viral — window closes soon)
- 48h: video is <36h old AND outperformanceFactor ≥ 1.5 (strong early momentum)
- 168h: category is music/tutorials OR channelConsistency < 30% OR outperformanceFactor < 0.8
         (slow-burn or chaotic — needs more time)
- 72h: default for all other cases
```

### Algorithmic fallback multipliers (contract.ts)

```typescript
case "low":
  return {
    ...
    milestoneThreshold: roundToClean(projected * 2.0),
    bParameter: 75,
    resolutionHours: resolveWindow(videoAgeHours, outperformanceFactor, channelConsistency),
  };
case "medium":
  return {
    ...
    milestoneThreshold: roundToClean(projected * 1.5),
    bParameter: 100,
    resolutionHours: resolveWindow(videoAgeHours, outperformanceFactor, channelConsistency),
  };
case "high":
  return {
    ...
    milestoneThreshold: roundToClean(projected * 1.2),
    bParameter: 150,
    resolutionHours: resolveWindow(videoAgeHours, outperformanceFactor, channelConsistency),
  };
```

Where `resolveWindow(videoAgeHours, outperformanceFactor, channelConsistency)` implements the characteristic-based logic above. This helper can also be exported for unit testing.

### New test file: `src/lib/__tests__/contract.test.ts`

Cover:
- `assignRiskTier()`: boundary values at 40, 70, 0, 100
- `calculateConfidence()`: age in/out of sweet spot, variance edge cases
- `roundToClean()`: values crossing each breakpoint (9999, 10000, 100000, etc.)
- `calculateContractRecommendations()`: all three tiers, verify threshold > projection

## Sources & References

- **Origin document:** [docs/brainstorms/2026-03-23-autofill-contract-calibration-fix-requirements.md](../brainstorms/2026-03-23-autofill-contract-calibration-fix-requirements.md)
  - Key decisions carried forward: (1) target 35–50% YES probability per market, (2) decouple resolution window from threshold hit probability, (3) recalibrate both LLM and algorithmic paths

- **Institutional learnings:**
  - `docs/solutions/integration-issues/anthropic-claude-api-nextjs-server-action.md` — LLM median calibration techniques; confirms mean-vs-percentile is the known failure mode
  - `docs/solutions/integration-issues/youtube-data-api-analytics-contract-generation.md` — b=75/100/150 starting values; confirms these are untested baselines

- **Implementation files:**
  - `src/lib/prediction.ts` — SYSTEM_PROMPT, buildUserPrompt(), generateContractPrediction()
  - `src/lib/contract.ts` — calculateContractRecommendations(), calculateConfidence(), roundToClean()
  - `src/lib/actions/admin.ts:193–217` — LLM try/catch + fallback wiring
  - `src/lib/__tests__/lmsr.test.ts` — existing test patterns to follow
