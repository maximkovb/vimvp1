import { allPrices } from "@/lib/lmsr";

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
 * Milestone slider ceiling: max(5× anchor, ceil(currentAnalytics × 1.5)).
 * Raised dynamically so the floor never exceeds the ceiling for already-viral videos.
 */
export function computeMilestoneMax(anchor: number, currentAnalytics: number): number {
  return Math.max(Math.round(anchor * 5), Math.ceil(currentAnalytics * 1.5));
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
