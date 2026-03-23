export type RiskTier = "low" | "medium" | "high";

export interface ContractRecommendation {
  /** Discriminant — use isLLMRecommendation() to narrow to LLMContractRecommendation. */
  predictionSource: "algorithmic" | "llm";
  riskTier: RiskTier;
  milestoneThreshold: number;
  bParameter: number;
  resolutionHours: 24 | 48 | 72 | 168;
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

/** Round a raw projection to a clean milestone number. */
function roundToClean(value: number): number {
  if (value < 10_000) return Math.round(value / 1_000) * 1_000;
  if (value < 100_000) return Math.round(value / 5_000) * 5_000;
  if (value < 500_000) return Math.round(value / 10_000) * 10_000;
  if (value < 2_000_000) return Math.round(value / 50_000) * 50_000;
  return Math.round(value / 100_000) * 100_000;
}

/**
 * Given a confidence score and video/channel analytics, return recommended
 * contract terms. All values are starting calibration — tune after deploy.
 *
 * Projection formula: logarithmic growth from current velocity toward 72h.
 *
 * bParameter baseline (b=50: ~$35 moves price 50%→75%; b=200: ~$139):
 *   Low risk  (consistent channel): b=75   — tight, predictable market
 *   Med risk  (moderate variance):  b=100  — standard market
 *   High risk (chaotic channel):    b=150  — wide spread, high uncertainty
 */
export function calculateContractRecommendations(
  confidence: number,
  currentViews: number,
  videoAgeHours: number,
  recentViewCounts: number[]
): ContractRecommendation {
  const tier = assignRiskTier(confidence);

  const safeAge = Math.max(videoAgeHours, 0.1);
  const projected = Math.round(
    currentViews * (Math.log(72 + 1) / Math.log(safeAge + 1))
  );
  const avgViews =
    recentViewCounts.length > 0
      ? recentViewCounts.reduce((acc, v) => acc + v, 0) / recentViewCounts.length
      : currentViews;

  switch (tier) {
    case "low":
      return {
        predictionSource: "algorithmic",
        riskTier: tier,
        milestoneThreshold: roundToClean(projected),
        bParameter: 75,
        resolutionHours: 48,
      };
    case "medium":
      return {
        predictionSource: "algorithmic",
        riskTier: tier,
        milestoneThreshold: roundToClean(projected * 0.6 + avgViews * 0.4),
        bParameter: 100,
        resolutionHours: 72,
      };
    case "high":
      return {
        predictionSource: "algorithmic",
        riskTier: tier,
        milestoneThreshold: roundToClean(
          (projected * 0.6 + avgViews * 0.4) * 0.8
        ),
        bParameter: 150,
        resolutionHours: 72,
      };
  }
}
