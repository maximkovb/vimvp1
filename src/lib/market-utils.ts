import { allPrices } from "@/lib/lmsr";
import {
  computeExpectedOutcome,
  computeCalibrationProbability,
} from "./calibration";

/**
 * Milestone slider floor: max(0.1× anchor, ceil(currentAnalytics × 1.2)).
 * Ensures the target always requires measurable future growth above the video's current count.
 * Note: the server-side guard in createMarket enforces only the analytics component
 * (ceil(current × 1.2)) because the anchor is a client-supplied value. The anchor component
 * (0.1× anchor) is a UX constraint enforced by the slider UI only.
 */
export function computeMilestoneFloor(anchor: number, currentAnalytics: number): number {
  return Math.max(Math.round(anchor * 0.1), Math.ceil(currentAnalytics * 1.2));
}

/**
 * Client-side probability estimate using the shared calibration model.
 * Uses computeExpectedOutcome (max of velocity projection and channel baseline at horizon)
 * so the live display matches the same formula used by both generation paths.
 *
 * @param channelAvgViews - Pass 0 or omit when channel data is unavailable; degrades to
 *   velocity-only projection (same as the old formula).
 */
export function computeProbability(
  currentAnalytics: number,
  videoAgeHours: number,
  windowHours: number,
  milestone: number,
  channelAvgViews = 0
): number {
  if (currentAnalytics <= 0 || milestone <= 0 || windowHours <= 0) return 0.5;
  const expected = computeExpectedOutcome(
    currentAnalytics,
    videoAgeHours,
    windowHours,
    channelAvgViews
  );
  return computeCalibrationProbability(expected, milestone);
}

export function getMarketPrices(market: {
  quantityYes: string;
  quantityNo: string;
  bParameter: string;
}) {
  const quantities = [
    parseFloat(market.quantityYes),
    parseFloat(market.quantityNo),
  ];
  const b = parseFloat(market.bParameter);
  return allPrices(quantities, b);
}
