const RESOLUTION_PRESETS = [24, 48, 72, 168] as const;

/**
 * Snap proportional hours to the nearest resolution preset (linear distance).
 * Ties go to shorter (first match wins due to strict `<`).
 */
export function snapToPreset(hours: number): string {
  return String(
    RESOLUTION_PRESETS.reduce((best, preset) =>
      Math.abs(preset - hours) < Math.abs(best - hours) ? preset : best
    )
  );
}

/** Step size for the milestone slider: 1/10th of the anchor's order of magnitude. Min 1. e.g. anchor=100000 → step=10000 */
export function computeStep(anchor: number): number {
  return Math.max(1, Math.pow(10, Math.floor(Math.log10(anchor)) - 1));
}

/**
 * Milestone slider floor: max(0.1× anchor, ceil(currentAnalytics × 1.2)).
 * Ensures the target always requires measurable future growth above the video's current count.
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
