const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const YT_TIMEOUT_MS = 8_000;
const YOUTUBE_THUMBNAIL_RE = /^https:\/\/i\.ytimg\.com\//;

export interface ChannelVideo {
  id: string;
  title: string;
  thumbnail: string;
  viewCount: number;
  likeCount: number;
}

interface YTChannelResponse {
  items?: Array<{
    contentDetails: { relatedPlaylists: { uploads: string } };
  }>;
}

interface YTPlaylistItemsResponse {
  items?: Array<{
    contentDetails: { videoId: string };
  }>;
}

interface YTVideosResponse {
  items?: Array<{
    id: string;
    snippet: {
      title: string;
      thumbnails?: { medium?: { url: string }; default?: { url: string } };
    };
    statistics: {
      viewCount?: string;
      likeCount?: string;
    };
  }>;
}

/**
 * Fetches up to 10 most recent videos from a YouTube channel.
 * Results are cached for 1 hour via Next.js data cache (revalidate: 3600).
 * Returns [] on any failure — never throws.
 */
export async function fetchChannelRecentVideos(
  channelId: string
): Promise<ChannelVideo[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  try {
    // Step 1: Get the uploads playlist ID for this channel
    const channelRes = await fetch(
      `${YOUTUBE_API_BASE}/channels?part=contentDetails&id=${channelId}&key=${apiKey}&fields=items(contentDetails/relatedPlaylists/uploads)`,
      {
        signal: AbortSignal.timeout(YT_TIMEOUT_MS),
        next: { revalidate: 3600 },
      }
    );
    if (!channelRes.ok) return [];

    const channelData: YTChannelResponse = await channelRes.json();
    const uploadsPlaylistId =
      channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) return [];

    if (!channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads) {
      console.warn("[fetchChannelRecentVideos] uploads playlist ID missing from channel response");
    }

    // Step 2: Get the 10 most recent video IDs from the uploads playlist
    const playlistRes = await fetch(
      `${YOUTUBE_API_BASE}/playlistItems?part=contentDetails&playlistId=${uploadsPlaylistId}&maxResults=10&key=${apiKey}&fields=items(contentDetails/videoId)`,
      {
        signal: AbortSignal.timeout(YT_TIMEOUT_MS),
        next: { revalidate: 3600 },
      }
    );
    if (!playlistRes.ok) return [];

    const playlistData: YTPlaylistItemsResponse = await playlistRes.json();
    const videoIds = (playlistData.items ?? [])
      .map((item) => item.contentDetails.videoId)
      .filter(Boolean);
    if (videoIds.length === 0) return [];

    // Step 3: Fetch snippet + statistics for those videos
    const videosRes = await fetch(
      `${YOUTUBE_API_BASE}/videos?part=snippet,statistics&id=${videoIds.join(",")}&key=${apiKey}&fields=items(id,snippet(title,thumbnails/medium/url,thumbnails/default/url),statistics(viewCount,likeCount))`,
      {
        signal: AbortSignal.timeout(YT_TIMEOUT_MS),
        next: { revalidate: 3600 },
      }
    );
    if (!videosRes.ok) return [];

    const videosData: YTVideosResponse = await videosRes.json();
    return (videosData.items ?? []).map((item) => {
      const thumbnailUrl =
        item.snippet.thumbnails?.medium?.url ??
        item.snippet.thumbnails?.default?.url ??
        "";
      const thumbnail = YOUTUBE_THUMBNAIL_RE.test(thumbnailUrl)
        ? thumbnailUrl
        : "";
      return {
        id: item.id,
        title: item.snippet.title,
        thumbnail,
        viewCount: parseInt(item.statistics.viewCount ?? "0", 10),
        likeCount: parseInt(item.statistics.likeCount ?? "0", 10),
      };
    });
  } catch {
    // Any network/timeout/parse error — return empty; never break the caller
    return [];
  }
}
