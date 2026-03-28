import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { YOUTUBE_API_BASE, YT_TIMEOUT_MS } from "@/lib/constants";
import { extractVideoId } from "@/lib/youtube";

/**
 * GET /api/admin/video-stats?url=<youtubeUrl>
 *
 * Bearer-token authenticated equivalent of the fetchVideoStats() server action.
 * Use this when calling from an agent or cron job (no browser session available).
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 *
 * Response: { videoId, title, thumbnail, channelTitle, channelId, description,
 *             viewCount, likeCount, publishedAt, categoryId? }
 */
export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url query parameter required" }, { status: 400 });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "YouTube API key not configured" }, { status: 500 });
  }

  const videoRes = await fetch(
    `${YOUTUBE_API_BASE}/videos?part=snippet,statistics&id=${videoId}&key=${apiKey}&fields=items(snippet(title,thumbnails,channelTitle,channelId,publishedAt,categoryId,description),statistics(viewCount,likeCount))`,
    { next: { revalidate: 300 }, signal: AbortSignal.timeout(YT_TIMEOUT_MS) }
  );

  if (!videoRes.ok) {
    const isQuota = videoRes.status === 403;
    return NextResponse.json(
      { error: isQuota ? "YouTube API quota exceeded" : "YouTube API error" },
      { status: 502 }
    );
  }

  const data = await videoRes.json();
  if (!data.items || data.items.length === 0) {
    return NextResponse.json({ error: "Video not found or is private" }, { status: 404 });
  }

  const item = data.items[0];
  const thumbnails = item.snippet.thumbnails;

  return NextResponse.json({
    videoId,
    title: item.snippet.title,
    thumbnail: thumbnails?.medium?.url ?? thumbnails?.default?.url ?? "",
    channelTitle: item.snippet.channelTitle,
    channelId: item.snippet.channelId,
    description: item.snippet.description ?? "",
    viewCount: parseInt(item.statistics.viewCount || "0"),
    likeCount: parseInt(item.statistics.likeCount || "0"),
    publishedAt: item.snippet.publishedAt,
    ...(item.snippet.categoryId ? { categoryId: item.snippet.categoryId } : {}),
  });
}
