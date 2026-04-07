import { db } from "@/db";
import { markets } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { fetchTikTokStatsById } from "@/lib/tiktok";
import { TIKTOK_VIDEO_ID_RE } from "@/lib/constants";

export const maxDuration = 60;

// Headers that make TikWM/TikTok CDN accept requests from our server
const UPSTREAM_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.tiktok.com/",
  Origin: "https://www.tiktok.com",
};

async function fetchFreshPlayUrl(videoId: string): Promise<string | null> {
  try {
    const stats = await fetchTikTokStatsById(videoId);
    return stats?.playUrl || null;
  } catch {
    return null;
  }
}

async function streamFrom(
  playUrl: string,
  rangeHeader: string | null
): Promise<Response | null> {
  try {
    const upstream = await fetch(playUrl, {
      headers: {
        ...UPSTREAM_HEADERS,
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      },
    });

    // Accept 200 (full) or 206 (partial/range)
    if (upstream.status !== 200 && upstream.status !== 206) return null;
    if (!upstream.body) return null;

    const headers = new Headers({
      "Content-Type": upstream.headers.get("content-type") ?? "video/mp4",
      "Accept-Ranges": "bytes",
      // Short cache — URLs expire ~24h but we re-proxy so let browser cache 1h
      "Cache-Control": "public, max-age=3600",
    });

    const contentLength = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    if (contentLength) headers.set("Content-Length", contentLength);
    if (contentRange) headers.set("Content-Range", contentRange);

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return null;
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;

  if (!TIKTOK_VIDEO_ID_RE.test(videoId)) {
    return new Response(null, { status: 400 });
  }

  const rangeHeader = req.headers.get("range");

  // 1. Try cached play URL from DB
  const [market] = await db
    .select({ videoMetadata: markets.videoMetadata })
    .from(markets)
    .where(eq(markets.videoId, videoId))
    .limit(1);

  const cachedUrl = market?.videoMetadata?.playUrl ?? null;

  if (cachedUrl) {
    const res = await streamFrom(cachedUrl, rangeHeader);
    if (res) return res;
    // Cached URL failed (expired) — fall through to refresh
  }

  // 2. No market record and no cached URL — refuse to act as open proxy
  if (!market && !cachedUrl) {
    return new Response(null, { status: 404 });
  }

  // 3. Fetch fresh URL from TikWM (only for known market videos)
  const freshUrl = await fetchFreshPlayUrl(videoId);
  if (!freshUrl) {
    return new Response(null, { status: 404 });
  }

  // Cache the fresh URL back to DB so subsequent requests don't re-hit TikWM
  db.update(markets)
    .set({
      videoMetadata: sql`jsonb_set(coalesce(video_metadata, '{}'), '{playUrl}', ${JSON.stringify(freshUrl)}::jsonb)`,
    })
    .where(eq(markets.videoId, videoId))
    .catch(() => {}); // fire-and-forget — don't block the stream

  const res = await streamFrom(freshUrl, rangeHeader);
  if (res) return res;

  return new Response(null, { status: 502 });
}
