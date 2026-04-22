/**
 * Shared calibration utilities — single source of truth for all milestone/probability math.
 *
 * All three code paths (algorithmic fallback in contract.ts, LLM path in prediction.ts,
 * and client-side display in market-utils.ts) import from here to stay consistent.
 *
 * Core model:
 *   expectedOutcome = max(velocityProjection, channelAvgAtHorizon)
 *   estimatedProbability = expectedOutcome / milestone
 *
 * Target probability range: 25–45% YES (lean toward failure for genuine market tension).
 */

/**
 * Fraction of total view accumulation expected by each resolution window horizon.
 *
 * Approximation: TikTok videos typically accumulate ~55% of total views in the first 24h,
 * ~80% by 48h, and reach ~100% by 72h.
 * TODO: Re-tune these ratios empirically once the platform has enough resolved TikTok markets.
 *
 * These are exported so the LLM system prompt (prediction.ts) stays in sync with the
 * algorithmic path. Change here → both paths update automatically.
 */
/** Target probability range for well-calibrated markets (lean toward failure). */
export const CALIBRATED_PROB_MIN = 0.25;
export const CALIBRATED_PROB_MAX = 0.45;

/** All valid resolution windows. Extend here and the type follows automatically. */
export const RESOLUTION_HOURS = [24, 48, 72] as const;
export type ResolutionHours = (typeof RESOLUTION_HOURS)[number];

export const HORIZON_FRACTION: Record<ResolutionHours, number> = {
  24: 0.55,
  48: 0.80,
  72: 1.00,
};

/**
 * Logarithmic velocity projection — what this video is tracking toward based on
 * its current velocity. Same formula across all code paths.
 */
export function projectVelocity(
  currentViews: number,
  videoAgeHours: number,
  windowHours: number
): number {
  const safeAge = Math.max(videoAgeHours, 0.1);
  return Math.round(
    currentViews * (Math.log(windowHours + 1) / Math.log(safeAge + 1))
  );
}

/**
 * Channel average scaled to a given window horizon.
 * Uses HORIZON_FRACTION — see that constant for the accumulation ratios and tuning notes.
 */
export function channelAvgAtHorizon(
  channelAvgViews: number,
  windowHours: ResolutionHours
): number {
  return Math.round(channelAvgViews * HORIZON_FRACTION[windowHours]);
}

/**
 * The floor expected outcome: max of velocity projection and channel baseline at horizon.
 *
 * This is the base ALL milestone calculations must exceed. A channel that consistently
 * hits 300K views will reach that whether or not the early-hour velocity is slow.
 * Pass channelAvgViews = 0 to degrade to velocity-only (e.g., when channel data unavailable).
 */
export function computeExpectedOutcome(
  currentViews: number,
  videoAgeHours: number,
  windowHours: number,
  channelAvgViews: number
): number {
  const velocity = projectVelocity(currentViews, videoAgeHours, windowHours);
  // channelAvgAtHorizon only handles preset values; for non-preset windows, use linear scaling
  const fraction =
    windowHours <= 24
      ? HORIZON_FRACTION[24]
      : windowHours <= 48
        ? HORIZON_FRACTION[48]
        : HORIZON_FRACTION[72];
  const channelFloor = Math.round(channelAvgViews * fraction);
  return Math.max(velocity, channelFloor);
}

/**
 * Probability the milestone will be hit, given expected outcome.
 * expectedOutcome / milestone, clamped to [0, 1].
 *
 * Returns 0.5 as a neutral sentinel when inputs are degenerate (missing/zero data).
 * IMPORTANT: callers must treat 0.5 returned for zero inputs as "data unavailable",
 * NOT as a calibrated probability estimate.
 */
export function computeCalibrationProbability(
  expectedOutcome: number,
  milestone: number
): number {
  if (expectedOutcome <= 0 || milestone <= 0) return 0.5;
  return Math.min(1, Math.max(0, expectedOutcome / milestone));
}
