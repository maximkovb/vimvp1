import { fetchTikTokStatsById } from "@/lib/tiktok";
import { TIKTOK_VIDEO_ID_RE, TIKTOK_PLAY_URL_RE } from "@/lib/constants";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;

  if (!TIKTOK_VIDEO_ID_RE.test(videoId)) {
    return NextResponse.json({ error: "Invalid video ID format" }, { status: 400 });
  }

  let stats;
  try {
    stats = await fetchTikTokStatsById(videoId);
  } catch {
    return NextResponse.json({ error: "Failed to fetch video" }, { status: 502 });
  }

  if (!stats?.playUrl || !TIKTOK_PLAY_URL_RE.test(stats.playUrl)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ playUrl: stats.playUrl });
}
