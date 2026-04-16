import type { ProjectionLabel } from "@/db/schema";

export function computeProjectionLabel({
  currentMetric,
  metric24hAgo,
  milestoneThreshold,
  resolvesAt,
}: {
  currentMetric: number;
  metric24hAgo: number | null;
  milestoneThreshold: number;
  resolvesAt: Date;
}): ProjectionLabel {
  const hoursRemaining = (resolvesAt.getTime() - Date.now()) / (1000 * 60 * 60);

  if (hoursRemaining <= 0) return "AT_RISK";

  const viewsRemaining = milestoneThreshold - currentMetric;
  if (viewsRemaining <= 0) return "BREAKING_OUT";

  const requiredVelocity = viewsRemaining / hoursRemaining;

  // < 24h of poll history — low-confidence fallback per spec
  if (metric24hAgo === null) return "ON_TRACK";

  const rollingVelocity = (currentMetric - metric24hAgo) / 24;

  if (rollingVelocity <= 0) return "AT_RISK";
  if (rollingVelocity >= 1.1 * requiredVelocity) return "BREAKING_OUT";
  if (rollingVelocity >= 0.8 * requiredVelocity) return "ON_TRACK";
  return "AT_RISK";
}

export const PROJECTION_EXPLANATIONS: Record<ProjectionLabel, string> = {
  ON_TRACK: "This video is on pace to hit its milestone by the deadline.",
  AT_RISK: "Velocity is below the pace needed to hit this milestone.",
  BREAKING_OUT: "Growing faster than required — this market is trending.",
};
