import { db } from "@/db";
import { markets } from "@/db/schema";
import { and, eq, or } from "drizzle-orm";
import {
  calculateConfidence,
  calculateContractRecommendations,
  type ContractRecommendation,
  type LLMContractRecommendation,
} from "@/lib/contract";
import { generateContractPrediction, type VideoContext } from "@/lib/prediction";
import { YOUTUBE_CHANNEL_ID_RE, YOUTUBE_API_BASE, YT_TIMEOUT_MS } from "@/lib/constants";

/** Uploads playlists are always "UU" + 22 base64url chars. */
const YOUTUBE_UPLOADS_PLAYLIST_RE = /^UU[a-zA-Z0-9_-]{22}$/;

/** In-process cache for channel analytics — reduces quota burn when the same channel
 *  is fetched multiple times within a short window (e.g., batch agent runs). */
interface ChannelCacheEntry {
  ts: number;
  subscriberCount: number;
  uploadsPlaylistId: string | undefined;
}
const channelCache = new Map<string, ChannelCacheEntry>();
const CHANNEL_CACHE_TTL_MS = 10 * 60 * 1_000; // 10 minutes

interface YTChannelItem {
  statistics: { subscriberCount?: string };
  contentDetails: { relatedPlaylists: { uploads: string } };
}

interface YTPlaylistItem {
  contentDetails: { videoId: string };
}

interface YTStatsItem {
  statistics: { viewCount?: string };
}

interface YTListResponse<T> {
  items?: T[];
}

/** Generate a template market title for the algorithmic fallback path. */
function generateTemplateTitle(
  milestone: number,
  metric: "views" | "likes",
  windowHours: number,
  outperformanceFactor: number,
  subscriberCount: number
): string {
  const n = milestone.toLocaleString();
  const m = metric;
  if (subscriberCount < 100_000 && outperformanceFactor > 1.5) {
    return `Can this underdog Short crack ${n} ${m} in ${windowHours}h?`;
  }
  if (outperformanceFactor > 3.0) {
    return `This Short is blowing up — will it hit ${n} ${m} in ${windowHours}h?`;
  }
  if (windowHours <= 24) {
    return `Just 24h to decide — will this Short crack ${n} ${m}?`;
  }
  return `Will this Short hit ${n} ${m} in ${windowHours}h?`;
}

export type MarketSuggestionInput = {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  categoryId?: string;
  viewCount: number;
  likeCount: number;
};

export type MarketSuggestionResult = {
  contract: ContractRecommendation | LLMContractRecommendation | null;
  suggestedTitle: string | null;
  videoAgeHours: number;
  subscriberCount: number;
  channelAvgViews: number;
  duplicateWarning: boolean;
};

/**
 * Core market suggestion logic — no auth, no session dependency.
 *
 * Called by:
 * - `generateMarketSuggestion()` server action (after auth() + isAdmin() check)
 * - `POST /api/admin/market-suggestion` API route (after verifyCronAuth() check)
 *
 * Each caller applies its own auth gate appropriate to its layer.
 */
export async function computeMarketSuggestion(
  input: MarketSuggestionInput,
  apiKey: string
): Promise<MarketSuggestionResult> {
  const { videoId, title, channelId, channelTitle, publishedAt, categoryId, viewCount, likeCount } = input;

  const videoAgeHours = Math.max(
    (Date.now() - new Date(publishedAt).getTime()) / 3_600_000,
    0.1
  );

  // Warn if an active or draft market already exists for this video
  const existing = await db
    .select({ id: markets.id })
    .from(markets)
    .where(
      and(
        eq(markets.videoId, videoId),
        or(eq(markets.status, "active"), eq(markets.status, "draft"))
      )
    )
    .limit(1);
  const duplicateWarning = existing.length > 0;

  let contract: ContractRecommendation | LLMContractRecommendation | null = null;
  let subscriberCount = 0;
  let channelAvgViews = viewCount; // fallback if channel fetch fails

  try {
    if (!YOUTUBE_CHANNEL_ID_RE.test(channelId)) {
      // Invalid channel ID format — skip channel fetch, fall through to algorithmic fallback below.
      throw new Error("Invalid channelId format");
    }

    const cached = channelCache.get(channelId);
    let uploadsPlaylistId: string | undefined;
    if (cached && Date.now() - cached.ts < CHANNEL_CACHE_TTL_MS) {
      subscriberCount = cached.subscriberCount;
      uploadsPlaylistId = cached.uploadsPlaylistId;
    } else {
      const channelRes = await fetch(
        `${YOUTUBE_API_BASE}/channels?part=statistics,contentDetails&id=${channelId}&key=${apiKey}&fields=items(statistics/subscriberCount,contentDetails/relatedPlaylists/uploads)`,
        { cache: "no-store", signal: AbortSignal.timeout(YT_TIMEOUT_MS) }
      );
      const channelData: YTListResponse<YTChannelItem> | null = channelRes.ok
        ? await channelRes.json()
        : null;
      subscriberCount = Number(channelData?.items?.[0]?.statistics?.subscriberCount ?? 0);
      const rawPlaylistId = channelData?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      // Validate the playlist ID returned by the API before interpolating into a URL.
      uploadsPlaylistId =
        rawPlaylistId && YOUTUBE_UPLOADS_PLAYLIST_RE.test(rawPlaylistId) ? rawPlaylistId : undefined;
      channelCache.set(channelId, { ts: Date.now(), subscriberCount, uploadsPlaylistId });
    }

    let recentViewCounts: number[] = [];
    if (uploadsPlaylistId) {
      const playlistRes = await fetch(
        `${YOUTUBE_API_BASE}/playlistItems?part=contentDetails&playlistId=${uploadsPlaylistId}&maxResults=10&key=${apiKey}&fields=items(contentDetails/videoId)`,
        { cache: "no-store", signal: AbortSignal.timeout(YT_TIMEOUT_MS) }
      );
      if (playlistRes.ok) {
        const playlistData: YTListResponse<YTPlaylistItem> = await playlistRes.json();
        const recentVideoIds = (playlistData.items ?? [])
          .map((v) => v.contentDetails.videoId)
          .filter(Boolean);

        if (recentVideoIds.length > 0) {
          const statsRes = await fetch(
            `${YOUTUBE_API_BASE}/videos?part=statistics&id=${recentVideoIds.join(",")}&key=${apiKey}&fields=items(statistics/viewCount)`,
            { cache: "no-store", signal: AbortSignal.timeout(YT_TIMEOUT_MS) }
          );
          if (statsRes.ok) {
            const statsData: YTListResponse<YTStatsItem> = await statsRes.json();
            recentViewCounts = (statsData.items ?? []).map((v) =>
              parseInt(v.statistics.viewCount || "0")
            );
          }
        }
      }
    }

    const mean =
      recentViewCounts.length > 0
        ? recentViewCounts.reduce((a, b) => a + b, 0) / recentViewCounts.length
        : viewCount;
    const stdDev =
      recentViewCounts.length > 1
        ? Math.sqrt(
            recentViewCounts.reduce((s, v) => s + (v - mean) ** 2, 0) /
              recentViewCounts.length
          )
        : 0;

    channelAvgViews = mean;

    const confidence = calculateConfidence(
      videoAgeHours,
      recentViewCounts,
      recentViewCounts.length > 1 ? mean : undefined,
      recentViewCounts.length > 1 ? stdDev : undefined
    );

    let suggestedTitle: string | null = null;

    try {
      const videoContext: VideoContext = {
        videoTitle: title,
        channelName: channelTitle,
        videoCategory: categoryId,
        videoAgeHours,
        publishedDayOfWeek: new Date(publishedAt).getUTCDay(),
        publishedHourUTC: new Date(publishedAt).getUTCHours(),
        currentViews: viewCount,
        currentLikes: likeCount,
        subscriberCount,
        channelAvgViews: mean,
        channelStdDev: stdDev,
      };
      const llmContract = await generateContractPrediction(videoContext);
      contract = llmContract;
      suggestedTitle = llmContract.suggestedTitle;
    } catch {
      // LLM failed — algorithmic fallback
      contract = calculateContractRecommendations(
        confidence,
        viewCount,
        videoAgeHours,
        recentViewCounts,
        mean
      );
      const outperformanceFactor = mean > 0 ? viewCount / mean : 1.0;
      suggestedTitle = generateTemplateTitle(
        contract.milestoneThreshold,
        "views",
        contract.resolutionHours,
        outperformanceFactor,
        subscriberCount
      );
    }

    return { contract, suggestedTitle, videoAgeHours, subscriberCount, channelAvgViews, duplicateWarning };
  } catch {
    // Channel fetch failed — return null contract so UI can still render stats panel
    return { contract: null, suggestedTitle: null, videoAgeHours, subscriberCount, channelAvgViews, duplicateWarning };
  }
}
