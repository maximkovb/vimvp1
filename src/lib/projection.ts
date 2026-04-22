import type { ProjectionLabel } from "@/db/schema";

export const DECELERATION_THRESHOLD = 0.5;
export const BREAKING_OUT_RATIO = 1.1;
export const ON_TRACK_RATIO = 0.8;
export const MIN_WINDOW_HOURS = 0.25;

export function computeProjectionLabel({
  currentMetric,
  recentVelocityPerHour,
  allTimeVelocityPerHour,
  priorVelocityPerHour,
  milestoneThreshold,
  resolvesAt,
}: {
  currentMetric: number;
  recentVelocityPerHour: number | null;
  allTimeVelocityPerHour: number | null;
  priorVelocityPerHour: number | null;
  milestoneThreshold: number;
  resolvesAt: Date;
}): ProjectionLabel {
  const hoursRemaining = (resolvesAt.getTime() - Date.now()) / (1000 * 60 * 60);

  if (hoursRemaining <= 0) return "AT_RISK";

  const viewsRemaining = milestoneThreshold - currentMetric;
  if (viewsRemaining <= 0) return "BREAKING_OUT";

  const requiredVelocity = viewsRemaining / hoursRemaining;

  if (recentVelocityPerHour === null || allTimeVelocityPerHour === null) return "AT_RISK";

  const effectiveVelocity = Math.min(recentVelocityPerHour, allTimeVelocityPerHour);

  if (effectiveVelocity <= 0) return "AT_RISK";

  const isDecelerating =
    priorVelocityPerHour !== null &&
    priorVelocityPerHour > 0 &&
    recentVelocityPerHour < priorVelocityPerHour * DECELERATION_THRESHOLD &&
    recentVelocityPerHour < requiredVelocity * BREAKING_OUT_RATIO;

  if (isDecelerating) return "AT_RISK";

  const ratio = effectiveVelocity / requiredVelocity;
  if (ratio >= BREAKING_OUT_RATIO) return "BREAKING_OUT";
  if (ratio >= ON_TRACK_RATIO) return "ON_TRACK";
  return "AT_RISK";
}

export const PROJECTION_EXPLANATIONS: Record<ProjectionLabel, string> = {
  ON_TRACK: "This video is on pace to hit its milestone by the deadline.",
  AT_RISK: "Velocity is below the pace needed to hit this milestone.",
  BREAKING_OUT: "Growing faster than required — this market is trending.",
};
