import { TIKTOK_VIDEO_ID_RE } from "@/lib/constants";

export interface TikTokStats {
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  createdAt: string;
  creatorName: string;
  creatorId: string;
  thumbnailUrl: string;
  tikapiPostId: string;
  /** Direct MP4 URL from TikWM CDN. CDN-signed, expires ~24h. */
  playUrl: string;
}

/**
 * Extracts TikTok video ID from various URL formats:
 * - https://www.tiktok.com/@user/video/1234567890123456789
 * - Bare numeric ID: "1234567890123456789"
 *
 * Short URLs (vm.tiktok.com, vt.tiktok.com) cannot be resolved
 * server-side without following redirects — returns null.
 */
export function extractTikTokVideoId(input: string): string | null {
  const trimmed = input.trim();

  // Bare numeric ID (15–20 digits)
  if (TIKTOK_VIDEO_ID_RE.test(trimmed)) return trimmed;

  // Full URL: tiktok.com/@user/video/<id>
  const longMatch = trimmed.match(/tiktok\.com\/@[^/]+\/video\/(\d{15,20})/);
  if (longMatch) return longMatch[1];

  return null;
}

/**
 * Returns true if the URL hostname is tiktok.com or a subdomain.
 * Uses URL parsing to avoid matching "tiktok.com" appearing elsewhere in the string.
 */
export function isTikTokUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "tiktok.com" || hostname.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}

/**
 * Fetches video stats by TikTok video ID via TikWM (free, no API key).
 * Returns null if the video is deleted or private.
 * Throws on network errors or unexpected HTTP responses.
 */
export async function fetchTikTokStatsById(
  videoId: string
): Promise<TikTokStats | null> {
  const url = `https://www.tikwm.com/api/?url=https://www.tiktok.com/@_/video/${videoId}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`TikWM HTTP ${res.status}`);
  const json = await res.json();
  if (json?.code !== 0 || !json?.data) return null; // deleted, private, or API error
  const d = json.data;
  return {
    viewCount:    d.play_count    ?? 0,
    likeCount:    d.digg_count    ?? 0,
    commentCount: d.comment_count ?? 0,
    shareCount:   d.share_count   ?? 0,
    createdAt:    new Date((d.create_time ?? 0) * 1000).toISOString(),
    creatorName:  d.author?.nickname  ?? "",
    creatorId:    d.author?.unique_id ?? "",
    thumbnailUrl: d.cover ?? "",
    tikapiPostId: d.id ?? videoId,
    // Prefer no-watermark, fall back to HD then watermarked — some videos omit d.play
    playUrl: d.play || d.hdplay || d.wmplay || "",
  };
}
