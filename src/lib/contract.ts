export type RiskTier = "low" | "medium" | "high";

export interface ContractRecommendation {
  /** Discriminant — use isLLMRecommendation() to narrow to LLMContractRecommendation. */
  predictionSource: "algorithmic" | "llm";
  riskTier: RiskTier;
  milestoneThreshold: number;
  bParameter: number;
  resolutionHours: 24 | 48 | 72;
}

export interface LLMContractRecommendation extends ContractRecommendation {
  predictionSource: "llm";
  reasoning: string;
  confidenceLevel: "high" | "medium" | "low";
  questionTypeRecommendation: "views" | "likes";
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
 * Choose resolution window based on video characteristics, NOT milestone hit probability.
 * Mirrors the LLM system prompt's resolution window rule so both paths behave consistently.
 *
 * @param videoAgeHours  - Age of the video in hours at fetch time
 * @param outperformanceFactor - currentViews / channelAvgViews (1.0 = exactly average)
 * @param channelConsistency  - 0–1 coefficient; 1 = perfectly consistent channel
 */
export function resolveWindow(
  videoAgeHours: number,
  outperformanceFactor: number,
  channelConsistency: number
): 24 | 48 | 72 {
  // Already viral — window closes soon, short deadline
  if (videoAgeHours >= 12 && outperformanceFactor >= 3.0) return 24;
  // Strong early momentum — medium window
  if (videoAgeHours < 36 && outperformanceFactor >= 1.5) return 48;
  // Slow-burn or chaotic channel — cap at 72h (was 168h)
  if (channelConsistency < 0.3 || outperformanceFactor < 0.8) return 72;
  // Default
  return 72;
}

/**
 * Given a confidence score and video/channel analytics, return recommended
 * contract terms. All values are starting calibration — tune after deploy.
 *
 * Thresholds are set at 1.2–2.0× the logarithmic projection at the chosen
 * resolution window to produce markets where YES resolves ~35–50% of the time.
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

  // outperformanceFactor: how this video compares to the channel baseline
  const outperformanceFactor =
    effectiveChannelAvg > 0 ? currentViews / effectiveChannelAvg : 1.0;

  // Channel consistency: 1 = perfectly consistent, 0 = chaotic
  let channelConsistency = 0.5; // default when insufficient data
  if (recentViewCounts.length > 1 && avgViews > 0) {
    const variance =
      recentViewCounts.reduce((acc, v) => acc + (v - avgViews) ** 2, 0) /
      recentViewCounts.length;
    channelConsistency = Math.max(0, 1 - Math.sqrt(variance) / avgViews);
  }

  const window = resolveWindow(videoAgeHours, outperformanceFactor, channelConsistency);

  // Project to the chosen window using logarithmic growth from current velocity
  const projected = Math.round(
    currentViews * (Math.log(window + 1) / Math.log(safeAge + 1))
  );

  switch (tier) {
    case "low":
      return {
        predictionSource: "algorithmic",
        riskTier: tier,
        milestoneThreshold: roundToClean(projected * 2.0),
        bParameter: 75,
        resolutionHours: window,
      };
    case "medium":
      return {
        predictionSource: "algorithmic",
        riskTier: tier,
        milestoneThreshold: roundToClean(projected * 1.5),
        bParameter: 100,
        resolutionHours: window,
      };
    case "high":
      return {
        predictionSource: "algorithmic",
        riskTier: tier,
        milestoneThreshold: roundToClean(projected * 1.2),
        bParameter: 150,
        resolutionHours: window,
      };
  }
}
