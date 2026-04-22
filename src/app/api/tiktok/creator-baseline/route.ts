import { fetchTikTokStatsById, fetchTikTokUserPosts } from "@/lib/tiktok";
import { TIKTOK_CREATOR_ID_RE, TIKTOK_VIDEO_ID_RE } from "@/lib/constants";
import { NextResponse } from "next/server";

export interface CreatorBaselineData {
  verdict: "ahead" | "on_pace" | "behind";
  deltaPercent: number;             // signed integer; positive = ahead
  videoViewsPerHr: number;          // rounded integer
  creatorMedianViewsPerHr: number;  // rounded integer
  baselineVideoCount: number;       // videos used for median (after filters)
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_BASELINE_COUNT = 3;
const AHEAD_THRESHOLD = 20;
const BEHIND_THRESHOLD = -20;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const creatorId = searchParams.get("creatorId") ?? "";
  const videoId = searchParams.get("videoId") ?? "";

  if (!TIKTOK_CREATOR_ID_RE.test(creatorId)) {
    return NextResponse.json({ error: "Invalid creatorId format" }, { status: 400 });
  }
  if (!TIKTOK_VIDEO_ID_RE.test(videoId)) {
    return NextResponse.json({ error: "Invalid videoId format" }, { status: 400 });
  }

  let userPosts, videoStats;
  try {
    [userPosts, videoStats] = await Promise.all([
      fetchTikTokUserPosts(creatorId),
      fetchTikTokStatsById(videoId),
    ]);
  } catch {
    return NextResponse.json({ error: "Failed to fetch creator data" }, { status: 502 });
  }

  if (userPosts === null) {
    return NextResponse.json({ error: "Creator not found" }, { status: 404 });
  }
  if (videoStats === null) {
    return NextResponse.json({ error: "insufficient_data" }, { status: 422 });
  }

  // Filter baseline: exclude current video and videos older than 90 days.
  // The 90-day window prevents age-distortion bias where year-old viral videos
  // would inflate the median views/hr far beyond the creator's current pace.
  const cutoffMs = Date.now() - NINETY_DAYS_MS;
  const baseline = userPosts.filter(
    (p) =>
      p.videoId !== videoId &&
      new Date(p.createdAt).getTime() >= cutoffMs
  );

  if (baseline.length < MIN_BASELINE_COUNT) {
    return NextResponse.json({ error: "insufficient_data" }, { status: 422 });
  }

  // Compute views/hr for each baseline video (floor age at 1hr to avoid division by zero).
  const now = Date.now();
  const baselineVelocities = baseline.map((p) => {
    const ageHrs = Math.max((now - new Date(p.createdAt).getTime()) / 3_600_000, 1);
    return p.viewCount / ageHrs;
  });

  // Median of baseline velocities.
  const sorted = [...baselineVelocities].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianVph =
    sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;

  // Current video velocity.
  const videoAgeHrs = Math.max(
    (now - new Date(videoStats.createdAt).getTime()) / 3_600_000,
    1
  );
  const videoVph = videoStats.viewCount / videoAgeHrs;

  // Delta and verdict.
  const deltaPercent = Math.round(((videoVph - medianVph) / medianVph) * 100);
  const verdict: CreatorBaselineData["verdict"] =
    deltaPercent > AHEAD_THRESHOLD
      ? "ahead"
      : deltaPercent < BEHIND_THRESHOLD
        ? "behind"
        : "on_pace";

  const data: CreatorBaselineData = {
    verdict,
    deltaPercent,
    videoViewsPerHr: Math.round(videoVph),
    creatorMedianViewsPerHr: Math.round(medianVph),
    baselineVideoCount: baseline.length,
  };

  return NextResponse.json(data);
}
