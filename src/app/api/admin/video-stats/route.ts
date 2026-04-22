import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { TIKTOK_THUMBNAIL_RE } from "@/lib/constants";
import { extractTikTokVideoId, fetchTikTokStatsById } from "@/lib/tiktok";

/**
 * GET /api/admin/video-stats?url=<videoUrl>
 *
 * Bearer-token authenticated equivalent of the fetchVideoStats() server action.
 * Accepts TikTok URLs only.
 * Use this when calling from an agent or cron job (no browser session available).
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 *
 * Response: { videoId, tikapiPostId, title, thumbnail, channelTitle,
 *             creatorId, viewCount, likeCount, publishedAt }
 */
export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url query parameter required" }, { status: 400 });
  }

  const videoId = extractTikTokVideoId(url);
  if (!videoId) {
    return NextResponse.json(
      { error: "Only TikTok URLs are supported — use https://www.tiktok.com/@user/video/<id>" },
      { status: 400 }
    );
  }

  let stats;
  try {
    stats = await fetchTikTokStatsById(videoId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TikTok API error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!stats) {
    return NextResponse.json({ error: "Video not found or is private" }, { status: 404 });
  }

  return NextResponse.json({
    videoId,
    tikapiPostId: stats.tikapiPostId,
    title: `@${stats.creatorId}`,
    thumbnail: TIKTOK_THUMBNAIL_RE.test(stats.thumbnailUrl) ? stats.thumbnailUrl : "",
    channelTitle: stats.creatorName,
    creatorId: stats.creatorId,
    viewCount: stats.viewCount,
    likeCount: stats.likeCount,
    publishedAt: stats.createdAt,
  });
}
