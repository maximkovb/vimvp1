import TikAPI from "tikapi";

/** TikAPI client — initialized lazily so missing key only throws at call time. */
function getClient() {
  const key = process.env.TIKAPI_KEY;
  if (!key) throw new Error("TIKAPI_KEY not configured");
  return TikAPI(key);
}

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
  if (/^\d{15,20}$/.test(trimmed)) return trimmed;

  // Full URL: tiktok.com/@user/video/<id>
  const longMatch = trimmed.match(/tiktok\.com\/@[^/]+\/video\/(\d{15,20})/);
  if (longMatch) return longMatch[1];

  return null;
}

/**
 * Returns true if the URL is a TikTok URL.
 */
export function isTikTokUrl(url: string): boolean {
  return /tiktok\.com/i.test(url);
}

/**
 * Fetches video stats by TikTok video ID.
 * Returns null if the video is deleted or private.
 * Throws on API errors (rate limit, auth failure, network).
 */
export async function fetchTikTokStatsById(
  videoId: string
): Promise<TikTokStats | null> {
  const api = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (api.public as any).post({ id: videoId });

  const item = response?.data?.itemInfo?.itemStruct;
  if (!item) return null; // deleted or private

  return {
    viewCount: item.stats?.playCount ?? 0,
    likeCount: item.stats?.diggCount ?? 0,
    commentCount: item.stats?.commentCount ?? 0,
    shareCount: item.stats?.shareCount ?? 0,
    createdAt: new Date((item.createTime ?? 0) * 1000).toISOString(),
    creatorName: item.author?.nickname ?? "",
    creatorId: item.author?.uniqueId ?? "",
    thumbnailUrl: item.video?.cover ?? "",
    tikapiPostId: item.id ?? videoId,
  };
}
