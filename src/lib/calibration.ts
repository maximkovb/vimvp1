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
 *
 * Approximation: YouTube Shorts typically accumulate ~55% of total views in the first 24h,
 * ~80% by 48h, and reach ~100% by 72h. Adjust these ratios empirically after deploy.
 */
export function channelAvgAtHorizon(
  channelAvgViews: number,
  windowHours: number
): number {
  if (windowHours <= 24) return Math.round(channelAvgViews * 0.55);
  if (windowHours <= 48) return Math.round(channelAvgViews * 0.8);
  return Math.round(channelAvgViews); // 72h → 100%
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
  const channelFloor = channelAvgAtHorizon(channelAvgViews, windowHours);
  return Math.max(velocity, channelFloor);
}

/**
 * Probability the milestone will be hit, given expected outcome.
 * expectedOutcome / milestone, clamped to [0, 1].
 * Returns 0.5 as a neutral fallback when inputs are degenerate.
 */
export function computeCalibrationProbability(
  expectedOutcome: number,
  milestone: number
): number {
  if (expectedOutcome <= 0 || milestone <= 0) return 0.5;
  return Math.min(1, Math.max(0, expectedOutcome / milestone));
}
