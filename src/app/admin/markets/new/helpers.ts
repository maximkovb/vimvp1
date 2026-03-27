const RESOLUTION_PRESETS = [24, 48, 72] as const;

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

// Re-exported from the shared lib so this module remains the single import point for page.tsx.
export { computeMilestoneFloor, computeProbability } from "../../../../lib/market-utils";
