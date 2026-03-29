---
title: "LLM contract calibration bias — easy milestones and fixed 72h resolution windows"
category: "logic-errors"
date: "2026-03-23"
tags: ["prediction-market", "contract-calibration", "resolution-window", "llm-anchoring", "milestone-difficulty", "autofill"]
module: "src/lib/contract.ts, src/lib/prediction.ts, src/lib/actions/admin.ts"
symptoms:
  - "Markets resolving YES 80-95%+ of the time"
  - "Resolution window always 72h regardless of video characteristics"
  - "LLM threshold anchoring to current video velocity instead of a challenging target"
  - "Milestone hit probability always in the P 10-20% band, collapsing window selection"
---

# LLM contract calibration bias — easy milestones and fixed 72h resolution windows

## Symptoms

- Auto-filled `milestoneThreshold` values were trivially exceeded by the video's trajectory — markets resolved YES near-constantly
- The `resolutionHours` field was always pre-filled with `72` regardless of video age, momentum, or channel characteristics
- When reviewing auto-filled values, admins could immediately see the threshold would be surpassed

## Root Cause

Two compounding problems in the auto-fill pipeline:

**1. Selection bias in velocity anchoring.** The system prompt told the LLM to set `milestoneThreshold` at the "80th–85th percentile of similar videos." But the only signal in the prompt was the video's *current* velocity — and admins select videos precisely because they are performing exceptionally. The LLM anchored on the current view count and projected forward modestly, setting thresholds the video would trivially surpass within hours. The "percentile" framing was unanchored: the LLM had no concrete number to calibrate against.

**2. Resolution window collapsed to one bucket.** The old window logic derived selection from milestone hit probability: `P < 10% → 168h`, `P 10-20% → 72h`, `P ≥ 20% → 48h`. Because the threshold was supposedly at 80–85th percentile, the implicit hit probability was always ~15–20%, landing every video in the 72h band. The window selection was effectively dead code producing a constant.

## Solution

Both problems share the same fix: replace vague percentage-based instructions with concrete numeric anchors derived from the video's actual data.

### 1. Algorithmic projections as LLM anchors (`src/lib/prediction.ts`)

Added `projectViews()` to `buildUserPrompt()`, which computes logarithmic growth estimates at each candidate window and injects them into the prompt as labeled lines:

```typescript
function projectViews(
  currentViews: number,
  videoAgeHours: number,
  targetHours: number
): number {
  const safeAge = Math.max(videoAgeHours, 0.1);
  return Math.round(
    currentViews * (Math.log(targetHours + 1) / Math.log(safeAge + 1))
  );
}
// Added to the user prompt:
// Outperformance factor: {N}x channel average
// Algorithmic projection (logarithmic growth from current velocity):
//   - At 24h: N views
//   - At 48h: N views
//   - At 72h: N views
//   - At 168h: N views
```

Also added `outperformanceFactor = currentViews / channelAvgViews` (guarded for zero) so the LLM knows when the video is already an outlier.

### 2. Updated system prompt goal (`src/lib/prediction.ts`)

Replaced the vague percentile instruction with a concrete multiplier rule:

```
Old GOAL: "Set milestoneThreshold at the 80th–85th percentile of expected outcome
for this channel — the value where only ~15–20% of this channel's videos reach it."

New GOAL: "Set milestoneThreshold at a genuinely challenging level — roughly 1.5–2×
the algorithmic projection provided in the prompt for the chosen resolution window.
- Do NOT set threshold below the algorithmic projection.
- High-confidence/consistent channels: 1.8–2.0× the projection.
- Low-confidence/chaotic channels: 1.2–1.5× the projection.
- Cap at 3× to avoid absurd thresholds for mega-channels."
```

### 3. Characteristic-based `resolveWindow()` (`src/lib/contract.ts`)

Replaced the hit-probability derivation with a pure function driven by observable video signals:

```typescript
export function resolveWindow(
  videoAgeHours: number,
  outperformanceFactor: number,
  channelConsistency: number
): 24 | 48 | 72 | 168 {
  // Already viral — window closes soon
  if (videoAgeHours >= 12 && outperformanceFactor >= 3.0) return 24;
  // Strong early momentum
  if (videoAgeHours < 36 && outperformanceFactor >= 1.5) return 48;
  // Slow-burn or chaotic channel
  if (channelConsistency < 0.3 || outperformanceFactor < 0.8) return 168;
  // Default
  return 72;
}
```

Both the LLM system prompt and the algorithmic fallback now use the same characteristic-based logic, so both paths behave consistently regardless of whether the LLM is available.

### 4. Harder fallback multipliers (`src/lib/contract.ts`)

Applied threshold multipliers against the projection for each risk tier:

| Tier | Multiplier | b | Resolution |
|------|-----------|---|------------|
| low  | 2.0× | 75 | resolveWindow() |
| medium | 1.5× | 100 | resolveWindow() |
| high | 1.2× | 150 | resolveWindow() |

Added `channelAvgViews` as an optional parameter so the outperformance factor is accurate when the caller (admin.ts) already has the computed mean.

### 5. Updated fallback call site (`src/lib/actions/admin.ts`)

```typescript
// Before
contract = calculateContractRecommendations(confidence, viewCount, videoAgeHours, recentViewCounts);

// After — pass mean so outperformanceFactor uses accurate channel baseline
contract = calculateContractRecommendations(confidence, viewCount, videoAgeHours, recentViewCounts, mean);
```

## Prevention

### Rules

1. **Never use percentile framing in LLM calibration prompts.** Percentile instructions require the LLM to estimate an internal distribution with only current-state data — this always collapses to anchoring on the most salient number in context. Use explicit multipliers over computed baselines instead.

2. **Always inject the numeric ceiling.** If you want the LLM to produce a value above some baseline, compute that baseline server-side and include it in the prompt. The model cannot exceed a limit it cannot see.

3. **Decouple correlated decisions.** When two outputs (threshold and resolution window) share a common denominator (hit probability), they will produce a correlated constant. Make each decision a pure function of independent inputs.

4. **Mirror LLM logic in the algorithmic fallback.** If the LLM system prompt and the fallback diverge on how windows are selected, the feature behaves inconsistently depending on API availability. `resolveWindow()` is exported and shared by both paths.

5. **Log raw threshold values, not just the final displayed value.** If post-processing (clamping, rounding) is applied, the diff between raw LLM output and final threshold should be auditable.

### Warning Signs

- Batch YES rate climbs above 65–70% over any 48h window
- `resolutionHours` is 72 for more than 80% of auto-filled markets
- Threshold values cluster tightly around a small set of round numbers (anchoring signal)
- LLM threshold variance is low across diverse velocity inputs

### Calibration Monitoring

- Log per-market: `raw_threshold`, `multiplier_applied`, `per_window_projections`, `resolved_window`, `final_threshold`
- Alert: rolling 24h YES rate > 65%
- Alert: CV (coefficient of variation) on thresholds < 0.15 across any batch of 20+ markets

### Regression Test Scenarios

1. **Viral spike anchor.** Video at 800K views/hour, 14h old, 3× channel avg → expect threshold > 1M for 24h window
2. **Slow-burn video.** Video at 2K views/hour, channelConsistency < 0.3 → expect `resolveWindow` returns 168h independently of threshold
3. **Batch diversity check.** 10 videos spanning 3 orders of magnitude in velocity → expect threshold CV > 0.3 and non-uniform window distribution

## Related

- [`docs/solutions/integration-issues/anthropic-claude-api-nextjs-server-action.md`](../integration-issues/anthropic-claude-api-nextjs-server-action.md) — LLM pipeline integration patterns (lazy init, `tool_choice`, Zod safeParse). **Note: Section 10 ("Prompt Engineering for Median Calibration") documents the now-superseded 50th-percentile approach — this fix replaces percentile framing entirely.**
- [`docs/solutions/integration-issues/youtube-data-api-analytics-contract-generation.md`](../integration-issues/youtube-data-api-analytics-contract-generation.md) — Original contract calibration system and YouTube API plumbing. **Note: the calibration table (b=75/100/150, 48/72h) is the superseded baseline this fix replaces.**
- [`docs/solutions/database-issues/nextjs-financial-app-code-review-patterns.md`](../database-issues/nextjs-financial-app-code-review-patterns.md) — LMSR b-parameter pricing math; server action safety patterns
- [`docs/plans/2026-03-23-001-fix-rarity-calibrated-autofill-contract-terms-plan.md`](../../plans/2026-03-23-001-fix-rarity-calibrated-autofill-contract-terms-plan.md) — The rarity/probability-based predecessor plan whose window logic collapsed to 72h in practice

## Files Changed

- `src/lib/contract.ts` — `resolveWindow()`, harder multipliers, `channelAvgViews` optional param, `roundToClean` exported
- `src/lib/prediction.ts` — `projectViews()`, `buildUserPrompt()` projections, updated `SYSTEM_PROMPT` goal and resolution window rule
- `src/lib/actions/admin.ts` — passes `mean` as `channelAvgViews` to fallback
- `src/lib/__tests__/contract.test.ts` — 32 new unit tests (new file)
