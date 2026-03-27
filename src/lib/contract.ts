import {
  computeExpectedOutcome,
  computeCalibrationProbability,
} from "./calibration";

export type RiskTier = "low" | "medium" | "high";

export interface ContractRecommendation {
  /** Discriminant — use isLLMRecommendation() to narrow to LLMContractRecommendation. */
  predictionSource: "algorithmic" | "llm";
  riskTier: RiskTier;
  milestoneThreshold: number;
  bParameter: number;
  resolutionHours: 24 | 48 | 72;
  /** Estimated probability of YES resolving (0–1). Used to display calibration quality to admin. */
  estimatedProbability: number;
}

export interface LLMContractRecommendation extends ContractRecommendation {
  predictionSource: "llm";
  reasoning: string;
  confidenceLevel: "high" | "medium" | "low";
  questionTypeRecommendation: "views" | "likes";
  /** LLM-generated engaging market question, pre-populates the title field. */
  suggestedTitle: string;
}

/**
 * Single source of truth for the LLM confidenceLevel → riskTier inversion.
 * High confidence = well-calibrated channel = low market risk.
 */
export const CONFIDENCE_TO_RISK_TIER: Record<
  LLMContractRecommendation["confidenceLevel"],
  RiskTier
> = {
  high: "low",
  medium: "medium",
  low: "high",
};

/**
 * Type guard — prefer this over `"predictionSource" in contract` checks.
 * Verifies the literal value, not just field presence.
 */
export function isLLMRecommendation(
  c: ContractRecommendation
): c is LLMContractRecommendation {
  return c.predictionSource === "llm";
}

/** Maps confidence score (0–100) → risk tier */
export function assignRiskTier(confidence: number): RiskTier {
  if (confidence >= 70) return "low";
  if (confidence >= 40) return "medium";
  return "high";
}

/**
 * Confidence score (0–100) based on:
 * - varianceScore: how consistent the channel's recent view counts are (lower CV = higher score)
 * - ageScore: 1.0 if video is 2–12h old (sweet spot for velocity data), 0.6 otherwise
 *
 * Pass precomputedMean/precomputedStdDev (when recentViewCounts.length > 1) to skip
 * the inner reduction — avoids double-computing what admin.ts already computed for VideoContext.
 */
export function calculateConfidence(
  videoAgeHours: number,
  recentViewCounts: number[],
  precomputedMean?: number,
  precomputedStdDev?: number
): number {
  let varianceScore = 0.5;

  if (
    precomputedMean !== undefined &&
    precomputedStdDev !== undefined &&
    precomputedMean > 0
  ) {
    // Use caller-supplied values — same formula, avoids re-iterating the array.
    varianceScore = Math.min(
      1,
      Math.max(0, 1 - precomputedStdDev / precomputedMean)
    );
  } else if (recentViewCounts.length > 1) {
    const mean =
      recentViewCounts.reduce((acc, v) => acc + v, 0) / recentViewCounts.length;
    if (mean > 0) {
      const variance =
        recentViewCounts.reduce((acc, v) => acc + (v - mean) ** 2, 0) /
        recentViewCounts.length;
      const stdDev = Math.sqrt(variance);
      varianceScore = Math.min(1, Math.max(0, 1 - stdDev / mean));
    }
  }

  const ageScore = videoAgeHours >= 2 && videoAgeHours <= 12 ? 1 : 0.6;
  return Math.round(varianceScore * ageScore * 100);
}

/** Round a raw projection to a clean milestone number. Exported for unit testing. */
export function roundToClean(value: number): number {
  if (value < 10_000) return Math.round(value / 1_000) * 1_000;
  if (value < 100_000) return Math.round(value / 5_000) * 5_000;
  if (value < 500_000) return Math.round(value / 10_000) * 10_000;
  if (value < 2_000_000) return Math.round(value / 50_000) * 50_000;
  return Math.round(value / 100_000) * 100_000;
}

/**
 * Choose resolution window based on video age — prefer the shortest window with ≥4h remaining.
 * Mirrors the LLM system prompt's resolution window rule so both paths behave consistently.
 *
 * Preference order: 24h → 48h → 72h (hard cap).
 * A window is viable only if ≥4h remain at resolution, preventing near-expired contracts.
 *
 * @param videoAgeHours  - Age of the video in hours at fetch time
 */
export function resolveWindow(videoAgeHours: number): 24 | 48 | 72 {
  // 24h: use unless video is ≥20h old (less than 4h would remain in the window)
  if (videoAgeHours < 20) return 24;
  // 48h: use when video is 20–43h old
  if (videoAgeHours < 44) return 48;
  // 72h: hard cap — last resort for old videos
  return 72;
}

/**
 * Given a confidence score and video/channel analytics, return recommended
 * contract terms. All values are starting calibration — tune after deploy.
 *
 * Thresholds are set at 2.2–3.0× the expected outcome (max of velocity projection and
 * channel avg at window horizon) to produce markets targeting 25–45% YES probability.
 * The LLM path produces the same calibration target — this is the fallback.
 *
 * bParameter baseline (b=50: ~$35 moves price 50%→75%; b=200: ~$139):
 *   Low risk  (consistent channel): b=75   — tight, predictable market
 *   Med risk  (moderate variance):  b=100  — standard market
 *   High risk (chaotic channel):    b=150  — wide spread, high uncertainty
 *
 * @param channelAvgViews - Optional: mean views across recent channel uploads.
 *   When provided, enables outperformance-factor-aware window selection.
 *   Falls back to averaging recentViewCounts when omitted.
 */
export function calculateContractRecommendations(
  confidence: number,
  currentViews: number,
  videoAgeHours: number,
  recentViewCounts: number[],
  channelAvgViews?: number
): ContractRecommendation {
  const tier = assignRiskTier(confidence);

  const safeAge = Math.max(videoAgeHours, 0.1);

  // Channel average: prefer caller-supplied (more accurate) over array mean
  const avgViews =
    recentViewCounts.length > 0
      ? recentViewCounts.reduce((acc, v) => acc + v, 0) / recentViewCounts.length
      : currentViews;
  const effectiveChannelAvg = channelAvgViews ?? avgViews;

  const window = resolveWindow(videoAgeHours);

  // Expected outcome: max(velocity projection, channel avg at window horizon).
  // This is the floor — milestone must be set above what the channel typically achieves.
  const expectedOutcome = computeExpectedOutcome(
    currentViews,
    safeAge,
    window,
    effectiveChannelAvg
  );

  function makeProbability(milestone: number): number {
    return computeCalibrationProbability(expectedOutcome, milestone);
  }

  // Multipliers target 25–45% YES probability: P = expectedOutcome / milestone,
  // so milestone = expectedOutcome / P. At midpoint P=0.35: milestone ≈ expectedOutcome × 2.86.
  //   Low risk  (consistent channel): 3.0× → ~33% probability
  //   Medium risk:                    2.5× → ~40% probability
  //   High risk  (chaotic channel):   2.2× → ~45% probability
  switch (tier) {
    case "low": {
      const milestoneThreshold = roundToClean(expectedOutcome * 3.0);
      return {
        predictionSource: "algorithmic",
        riskTier: tier,
        milestoneThreshold,
        bParameter: 75,
        resolutionHours: window,
        estimatedProbability: makeProbability(milestoneThreshold),
      };
    }
    case "medium": {
      const milestoneThreshold = roundToClean(expectedOutcome * 2.5);
      return {
        predictionSource: "algorithmic",
        riskTier: tier,
        milestoneThreshold,
        bParameter: 100,
        resolutionHours: window,
        estimatedProbability: makeProbability(milestoneThreshold),
      };
    }
    case "high": {
      const milestoneThreshold = roundToClean(expectedOutcome * 2.2);
      return {
        predictionSource: "algorithmic",
        riskTier: tier,
        milestoneThreshold,
        bParameter: 150,
        resolutionHours: window,
        estimatedProbability: makeProbability(milestoneThreshold),
      };
    }
  }
}
