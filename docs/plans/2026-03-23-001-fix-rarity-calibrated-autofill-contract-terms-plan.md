---
title: "fix: Rarity-Calibrated Auto-Fill Contract Terms"
type: fix
status: active
date: 2026-03-23
---

# fix: Rarity-Calibrated Auto-Fill Contract Terms

## Overview

The auto-fill feature produces contracts with two systematic problems: milestones that are too easy (targeting the 50th percentile of projected views), and time windows that are hardcoded by confidence tier rather than calibrated to how rare the milestone is. The result is markets with low stakes and windows that feel arbitrary. This fix replaces both with a single rarity-first design: the milestone targets the 85th percentile of the channel's historical view distribution, and the resolution window and LMSR liquidity parameter scale from that rarity.

---

## Problem Statement

### What's wrong

**Milestones are too easy (both paths)**

- The LLM system prompt asks for the "50th percentile (median)" — meaning roughly half of markets should resolve YES. A 50/50 bet is not risky.
- The algorithmic fallback projects views with a logarithmic formula toward 72h and blends with channel average. No rarity concept exists.

**Time windows are disconnected from rarity**

- Algorithmic path: hardcoded to `48` (low confidence) or `72` (medium/high confidence) regardless of how rare the milestone is.
- LLM path: Claude picks from [24, 48, 72, 168] based on content type (viral/niche). A 1-in-20 milestone gets the same window as a 1-in-5 milestone if both are "standard content."

**The right design**

If a creator hits 100k views on ~1-in-10 videos, a contract betting on whether a new video will hit 100k views should:
- Use that ~10% hit rate directly to set `resolutionHours` (72h)
- Use it to set `bParameter` (higher liquidity for rarer, more uncertain bets)

If that same channel's 1-in-20 milestone is used instead, the window should be longer (168h) and the bParameter higher.

---

## Proposed Solution

### Core mechanic: log-normal rarity estimation

YouTube view counts follow a log-normal distribution. Given `channelAvgViews` and `channelStdDev` (both already computed from 10 recent videos in `admin.ts:117–127`), we can estimate the probability that any given video reaches a threshold `x`:

```
CV = channelStdDev / channelAvgViews
σ_ln = sqrt(ln(1 + CV²))
μ_ln = ln(channelAvgViews) - (σ_ln² / 2)
hitProbability(x) = 1 - Φ((ln(x) - μ_ln) / σ_ln)
```

Where `Φ` is the standard normal CDF (approximated via a pure-JS Horner polynomial — no external library needed).

### Target milestone

Set milestone at the **85th percentile** of the channel's historical distribution (P(hit) ≈ 15%). This is the midpoint of the "risky but attainable" range (10–20% hit rate).

```
milestone = exp(μ_ln + 1.036 × σ_ln)   // Φ⁻¹(0.85) ≈ 1.036
```

Floor: `max(milestone, currentViews × 1.5)` — prevents setting a target below where the video already is.

### Rarity → contract term mapping

| Estimated hit probability | `resolutionHours` | `bParameter` |
|--------------------------|-------------------|-------------|
| P ≥ 20% (1-in-5 or easier) | 48 | 75 |
| P ≥ 10% and < 20% (1-in-10 to 1-in-5) | 72 | 100 |
| P < 10% (rarer than 1-in-10) | 168 | 150 |

Boundary convention: `P >= 20%` → 48h; `P >= 10%` → 72h; else 168h.

### Changes by file

**`src/lib/contract.ts`** — algorithmic path

- Add `computeLognormalParams(channelAvgViews, channelStdDev)` → `{ muLn, sigmaLn }`
- Add `standardNormalCDF(z)` — pure-JS approximation (Abramowitz & Stegun 7.1.26 or similar)
- Add `hitProbability(threshold, muLn, sigmaLn)` → probability in [0, 1]
- Add `lognormalPercentile(p, muLn, sigmaLn)` → view count at percentile `p` (inverse CDF: `exp(muLn + Φ⁻¹(p) * sigmaLn)`)
- Add `rarityToResolutionHours(p)` and `rarityToBParameter(p)` — the mapping table above
- Refactor `calculateContractRecommendations()` to:
  1. Attempt rarity-based path when `channelStdDev > 0` and `recentViewCounts.length >= 3`
  2. Compute 85th-percentile milestone, floor against `currentViews × 1.5`, clean-round
  3. Compute `hitProbability(milestone, ...)` → derive `resolutionHours` and `bParameter`
  4. Fall back to current logic when history is insufficient (< 3 videos or `stdDev = 0`)

**`src/lib/prediction.ts`** — LLM path

- In `buildUserPrompt()`, compute and append a rarity signal:
  ```
  Channel 85th-percentile milestone: ~{X} views (~15% of videos reach this)
  Estimated hit probability for a milestone in this range: {Y}%
  ```
  Computed from `channelAvgViews` / `channelStdDev` already in `VideoContext`.
- Update `SYSTEM_PROMPT` resolution window guidance to be rarity-first:
  ```
  RESOLUTION WINDOW (rarity-first — use the channel hit probability signal):
  - P < 10% (rarer than 1-in-10): 168h
  - P 10–20% (1-in-5 to 1-in-10): 72h
  - P ≥ 20% (easier than 1-in-5): 48h
  - 24h: only for already-viral videos (12h+ old, tracking 3× channel average)
  ```
- Update milestone target framing: change "50th percentile (MEDIAN)" to "80th–85th percentile — the value where only ~15–20% of similar-channel videos reach it."

`VideoContext` interface does **not** change — rarity signals are computed in `buildUserPrompt()` from existing primitives.

---

## Technical Considerations

- **Log-normal validity**: requires `channelStdDev > 0` and at least 3 recent videos. When invalid (new channel, private videos, API gaps), fall back to the current tier-based logic — log a `[autofill:rarity-fallback]` warning.
- **Milestone floor**: if `lognormalPercentile(0.85, ...) < currentViews × 1.5`, use the floored value and recompute `hitProbability(floor, ...)` to determine the window. This handles fast-rising videos.
- **The LLM output is not clamped**: Claude receives the rarity signal as advisory context but can still pick any `resolutionHours` enum value. This preserves the existing LLM-first design philosophy. If Claude's choice differs significantly from the rarity recommendation, that's the admin's problem to notice in the reasoning text.
- **`roundToClean()` stays unchanged** — the 85th-percentile value feeds through the existing rounding helper.
- **No schema changes**: `channelStdDev` is computed on-the-fly in `admin.ts` and passed through `VideoContext`; it is not persisted. Auditability comes from the LLM `reasoning` field and the auto-filled form values the admin sees before confirming.
- **No new dependencies**: log-normal CDF uses a polynomial approximation inline in `contract.ts`. Sufficient precision for this use case (±0.5% error acceptable).

## System-Wide Impact

- **Interaction graph**: `fetchVideoMetadata()` (admin.ts) calls `calculateContractRecommendations()` or `generateContractPrediction()` → result populates form fields → admin submits → `createMarket()` reads `resolutionHours` from form data. The create path is unchanged; the change is entirely in how the pre-fill values are computed.
- **Error propagation**: if rarity computation throws (e.g., `log(0)` from zero `channelAvgViews`), the `try/catch` in `admin.ts:158` catches analytics errors and sets `contract = null`. This falls through to static form defaults — no regression.
- **State lifecycle risks**: none. This is a read-only analytics computation; no database writes until the admin submits the form.
- **API surface parity**: both auto-fill paths (LLM + fallback) must produce rarity-calibrated results so the output quality is consistent regardless of which path fires.

---

## Acceptance Criteria

- [ ] Algorithmic path: a channel with `channelAvgViews = 500k`, `channelStdDev = 200k` produces a milestone near the 85th percentile (~800–900k), not the projected 72h view count
- [ ] Algorithmic path: same channel produces `resolutionHours = 72` (P ≈ 15%, in 10–20% band)
- [ ] Algorithmic path: a channel with P < 10% for its 85th-percentile milestone produces `resolutionHours = 168`
- [ ] Algorithmic path: a channel with P ≥ 20% produces `resolutionHours = 48`
- [ ] Milestone is floored at `currentViews × 1.5` when the log-normal 85th percentile falls below that
- [ ] Channel with `recentViewCounts.length < 3` falls back to current logic without error
- [ ] Channel with `channelStdDev = 0` (perfectly consistent) falls back without `log(0)` error
- [ ] LLM prompt includes the computed channel hit probability signal in `buildUserPrompt()` output
- [ ] LLM system prompt window guidance is rarity-first (not content-type-first)
- [ ] LLM system prompt milestone target is updated from "50th percentile" to "80th–85th percentile"
- [ ] Both paths: `bParameter` matches the rarity band (75 / 100 / 150) not just confidence tier
- [ ] `P = 10%` exactly → 72h (not 168h) per the `P >= 10%` boundary convention
- [ ] `P = 20%` exactly → 48h per the `P >= 20%` boundary convention

---

## Success Metrics

- Fewer than 20% of live markets resolve YES within the first 25% of the window (currently too high because milestones are too easy)
- LLM reasoning text references the channel hit probability signal ("~X% of videos reach this threshold")
- Admin review time per market decreases — auto-fill values require less manual correction

---

## Dependencies & Risks

- **Risk**: log-normal is a simplification. Some channels have bimodal distributions (regular uploads + occasional viral hits). The 85th-percentile milestone could land in the "gap" between the two modes, producing an odd bet. **Mitigation**: out of scope for this fix; the admin reviews the auto-fill before submitting.
- **Risk**: fewer than 3 recent videos is surprisingly common (new channels, channels that delete old videos). The fallback path must be robust. **Mitigation**: explicit `recentViewCounts.length < 3` guard before any log-normal computation.
- **Risk**: the LLM ignores the rarity signal and continues to target the 50th percentile. **Mitigation**: the system prompt change makes the 85th-percentile target explicit and ties it to the rarity number in the user prompt. If Claude still drifts, the algorithmic fallback (now rarity-calibrated) provides the correct values when LLM fails.
- **Dependency**: `channelAvgViews` and `channelStdDev` must be non-zero for the rarity path. Both are computed in `admin.ts:117–127` from `recentViewCounts` — already available before either auto-fill path fires.

---

## Sources & References

- Algorithmic fallback: `src/lib/contract.ts:64–106`
- LLM prediction engine: `src/lib/prediction.ts:93–178`
- Analytics fetch + VideoContext assembly: `src/lib/actions/admin.ts:79–144`
- Prior plan for LLM path: `docs/plans/2026-03-22-002-feat-llm-autofill-contract-prediction-plan.md`
- Prior plan for algorithmic path: `docs/plans/2026-03-22-001-feat-auto-contract-generation-plan.md`
- LLM integration learnings: `docs/solutions/integration-issues/anthropic-claude-api-nextjs-server-action.md`
- YouTube API learnings: `docs/solutions/integration-issues/youtube-data-api-analytics-contract-generation.md`
