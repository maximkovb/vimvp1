import { fetchTikTokStatsById } from "@/lib/tiktok";
import { NextResponse } from "next/server";
import { TIKTOK_VIDEO_ID_RE } from "@/lib/constants";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;

  if (!TIKTOK_VIDEO_ID_RE.test(videoId)) {
    return NextResponse.json({ error: "Invalid videoId" }, { status: 400 });
  }
  let stats;
  try {
    stats = await fetchTikTokStatsById(videoId);
  } catch {
    return NextResponse.json({ error: "Failed to fetch video" }, { status: 502 });
  }
  if (!stats?.playUrl) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ playUrl: stats.playUrl });
}
