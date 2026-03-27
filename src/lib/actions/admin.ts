"use server";

import { db } from "@/db";
import { markets, priceSnapshots, youtubePolls } from "@/db/schema";
import { and, eq, or } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { allPrices } from "@/lib/lmsr";
import { computeMilestoneFloor } from "@/lib/market-utils";
import { computeExpectedOutcome } from "@/lib/calibration";
import { revalidatePath } from "next/cache";
import { distributePayout, refundPositions } from "@/lib/services/payout";
import {
  calculateConfidence,
  calculateContractRecommendations,
  type ContractRecommendation,
  type LLMContractRecommendation,
} from "@/lib/contract";
import {
  generateContractPrediction,
  type VideoContext,
} from "@/lib/prediction";
import { YOUTUBE_THUMBNAIL_RE } from "@/lib/constants";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

/** Fetch timeout — prevents hung calls from blocking the 30s worker budget. */
const YT_TIMEOUT_MS = 8_000;

// ─── YouTube API response shapes ────────────────────────────────────────────

interface YTVideoItem {
  snippet: {
    title: string;
    channelId: string;
    channelTitle: string;
    publishedAt: string;
    categoryId?: string;
    description?: string;
    thumbnails?: {
      medium?: { url: string };
      default?: { url: string };
    };
  };
  statistics: {
    viewCount?: string;
    likeCount?: string;
  };
}

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  // Maybe it's already just a video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Phase 1 of two-phase fetch — fast video stats only (~500ms).
 * Returns video metadata without channel analytics or market suggestion.
 * Call generateMarketSuggestion next for the contract recommendation.
 */
export async function fetchVideoStats(url: string) {
  const session = await auth();
  if (!isAdmin(session)) return { error: "Unauthorized" };

  const videoId = extractVideoId(url);
  if (!videoId) return { error: "Invalid YouTube URL" };

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { error: "YouTube API key not configured" };

  const videoRes = await fetch(
    `${YOUTUBE_API_BASE}/videos?part=snippet,statistics&id=${videoId}&key=${apiKey}&fields=items(snippet(title,thumbnails,channelTitle,channelId,publishedAt,categoryId,description),statistics(viewCount,likeCount))`,
    { cache: "no-store", signal: AbortSignal.timeout(YT_TIMEOUT_MS) }
  );

  if (!videoRes.ok) {
    const isQuotaError = videoRes.status === 403;
    return { error: isQuotaError ? "YouTube API quota exceeded — try again later" : "YouTube API error" };
  }

  const videoData: YTListResponse<YTVideoItem> = await videoRes.json();
  if (!videoData.items || videoData.items.length === 0) {
    return { error: "Video not found or is private" };
  }

  const item = videoData.items[0];
  const thumbnails = item.snippet.thumbnails;

  return {
    videoId,
    title: item.snippet.title,
    thumbnail: thumbnails?.medium?.url ?? thumbnails?.default?.url ?? "",
    channelTitle: item.snippet.channelTitle,
    channelId: item.snippet.channelId,
    description: item.snippet.description ?? "",
    viewCount: parseInt(item.statistics.viewCount || "0"),
    likeCount: parseInt(item.statistics.likeCount || "0"),
    publishedAt: item.snippet.publishedAt,
    categoryId: item.snippet.categoryId,
  };
}

/**
 * Phase 2 of two-phase fetch — channel analytics + market suggestion (~5–15s with LLM).
 * Fetches channel baseline, computes velocity, runs LLM (with algorithmic fallback).
 * Returns the contract recommendation plus stats for the admin stats panel.
 */
export async function generateMarketSuggestion(input: {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  categoryId?: string;
  viewCount: number;
  likeCount: number;
}) {
  const session = await auth();
  if (!isAdmin(session)) return { error: "Unauthorized" };

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { error: "YouTube API key not configured" };

  const { videoId, title, channelId, channelTitle, publishedAt, categoryId, viewCount, likeCount } = input;

  const videoAgeHours = Math.max(
    (Date.now() - new Date(publishedAt).getTime()) / 3_600_000,
    0.1
  );

  // Warn admin if an active or draft market already exists for this video
  const existing = await db
    .select({ id: markets.id })
    .from(markets)
    .where(
      and(
        eq(markets.youtubeVideoId, videoId),
        or(eq(markets.status, "active"), eq(markets.status, "draft"))
      )
    )
    .limit(1);
  const duplicateWarning = existing.length > 0;

  let contract: ContractRecommendation | LLMContractRecommendation | null = null;
  let subscriberCount = 0;
  let channelAvgViews = viewCount; // fallback if channel fetch fails

  try {
    const channelRes = await fetch(
      `${YOUTUBE_API_BASE}/channels?part=statistics,contentDetails&id=${channelId}&key=${apiKey}&fields=items(statistics/subscriberCount,contentDetails/relatedPlaylists/uploads)`,
      { cache: "no-store", signal: AbortSignal.timeout(YT_TIMEOUT_MS) }
    );
    const channelData: YTListResponse<YTChannelItem> | null = channelRes.ok
      ? await channelRes.json()
      : null;
    subscriberCount = Number(channelData?.items?.[0]?.statistics?.subscriberCount ?? 0);
    const uploadsPlaylistId = channelData?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

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
      // LLM failed — algorithmic fallback. generateContractPrediction already logged.
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

    return {
      contract,
      suggestedTitle,
      videoAgeHours,
      subscriberCount,
      channelAvgViews,
      duplicateWarning,
    };
  } catch {
    // Channel fetch failed — return null contract so UI can still render stats panel
    return {
      contract: null,
      suggestedTitle: null,
      videoAgeHours,
      subscriberCount,
      channelAvgViews,
      duplicateWarning,
    };
  }
}

export async function createMarket(formData: FormData) {
  const session = await auth();
  if (!isAdmin(session)) return { error: "Unauthorized" };

  const videoUrl = (formData.get("videoUrl") ?? "") as string;
  const title = (formData.get("title") ?? "") as string;
  const description = (formData.get("description") ?? "") as string;
  const questionType = (formData.get("questionType") ?? "") as string;
  const milestoneThresholdRaw = (formData.get("milestoneThreshold") ??
    "") as string;
  const bParameterRaw = (formData.get("bParameter") ?? "") as string;
  const resolutionHours = (formData.get("resolutionHours") ?? "") as string;
  const publishImmediately = formData.get("publishImmediately") === "true";

  if (!videoUrl || !title || !questionType || !milestoneThresholdRaw) {
    return { error: "Required fields missing" };
  }

  // Runtime allowlist — TypeScript cast above does not enforce at runtime.
  if (questionType !== "views" && questionType !== "likes") {
    return { error: "Invalid questionType" };
  }
  // Narrow the type now that we've validated it.
  const validatedQuestionType = questionType as "views" | "likes";

  const videoId = extractVideoId(videoUrl);
  if (!videoId) return { error: "Invalid YouTube URL" };

  // Server-side bParameter validation — b=0 causes LMSR divide-by-zero.
  const b = parseFloat(bParameterRaw || "100");
  if (!isFinite(b) || b < 1 || b > 1000) {
    return { error: "bParameter must be between 1 and 1000" };
  }

  // Server-side milestoneThreshold validation — guards against non-integer or overflow.
  let thresholdBigInt: bigint;
  try {
    thresholdBigInt = BigInt(Math.round(Number(milestoneThresholdRaw)));
    if (thresholdBigInt < BigInt(1) || thresholdBigInt > BigInt(10_000_000_000)) {
      return { error: "milestoneThreshold must be between 1 and 10,000,000,000" };
    }
  } catch {
    return { error: "Invalid milestoneThreshold" };
  }

  // Floor guard — milestone must exceed what the channel typically achieves in the window.
  // These fields are required; omitting them is a hard error (not a silent bypass).
  // Number() correctly parses scientific notation ("1e6" → 1000000); parseInt would truncate to 1.
  const initialViewCount = Math.round(Number((formData.get("initialViewCount") ?? "") as string));
  const initialLikeCount = Math.round(Number((formData.get("initialLikeCount") ?? "") as string));
  if (!isFinite(initialViewCount) || !isFinite(initialLikeCount) ||
      initialViewCount < 0 || initialLikeCount < 0) {
    return { error: "initialViewCount and initialLikeCount are required" };
  }
  const initialCount = validatedQuestionType === "views" ? initialViewCount : initialLikeCount;

  // channelAvgViews and videoAgeHours are provided by the client (fetched during suggestion phase).
  // Falls back to 0/1 if missing, which degrades to velocity-only projection.
  const channelAvgViews = Math.max(
    0,
    Math.round(Number((formData.get("channelAvgViews") ?? "0") as string))
  );
  const videoAgeHoursRaw = Math.max(
    0.1,
    Number((formData.get("videoAgeHours") ?? "1") as string)
  );
  const videoAgeHoursVal = isFinite(videoAgeHoursRaw) ? videoAgeHoursRaw : 1;

  const resolutionHoursNum = parseInt(resolutionHours || "72");
  const requiredFloor = computeExpectedOutcome(
    initialCount,
    videoAgeHoursVal,
    resolutionHoursNum,
    channelAvgViews
  );
  if (Number(milestoneThresholdRaw) < requiredFloor) {
    return {
      error: `Milestone must exceed the expected ${validatedQuestionType} count at resolution (minimum: ${requiredFloor.toLocaleString()})`,
    };
  }

  // Read video metadata from hidden form fields — avoids re-calling fetchVideoMetadata
  // (which would trigger a second Claude API call)
  const videoTitle = (formData.get("videoTitle") as string) || "";
  const thumbnailRaw = (formData.get("thumbnail") as string) || "";
  const channelTitle = (formData.get("channelTitle") as string) || "";
  const channelId = (formData.get("channelId") as string) || undefined;
  const videoDescriptionRaw = (formData.get("videoDescription") as string) || undefined;
  const videoDescription = videoDescriptionRaw?.slice(0, 5000) || undefined;

  // Only persist thumbnails from YouTube's CDN — rejects injected URLs.
  const thumbnail = YOUTUBE_THUMBNAIL_RE.test(thumbnailRaw) ? thumbnailRaw : "";

  const now = new Date();
  const hours = parseInt(resolutionHours || "72");
  if (![24, 48, 72].includes(hours)) {
    return { error: "resolutionHours must be 24, 48, or 72" };
  }
  const resolvesAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
  const haltsAt = new Date(resolvesAt.getTime() - 5 * 60 * 1000);

  const marketId = crypto.randomUUID();

  await db.insert(markets).values({
    id: marketId,
    youtubeVideoId: videoId,
    title,
    description: description || null,
    questionType: validatedQuestionType,
    milestoneThreshold: thresholdBigInt,
    bParameter: b.toFixed(2),
    status: publishImmediately ? "active" : "draft",
    videoMetadata: {
      title: videoTitle,
      thumbnail,
      channelTitle,
      ...(channelId ? { channelId } : {}),
      ...(videoDescription ? { description: videoDescription } : {}),
    },
    opensAt: publishImmediately ? now : null,
    haltsAt: publishImmediately ? haltsAt : null,
    resolvesAt: publishImmediately ? resolvesAt : null,
    createdBy: session!.user!.id!,
  });

  // Create initial price snapshot
  if (publishImmediately) {
    const prices = allPrices([0, 0], b);
    await db.insert(priceSnapshots).values({
      marketId,
      priceYes: prices[0].toFixed(6),
      priceNo: prices[1].toFixed(6),
    });
  }

  // Insert initial poll row using the already-validated view/like counts above.
  await db.insert(youtubePolls).values({
    marketId,
    viewCount: BigInt(initialViewCount),
    likeCount: BigInt(initialLikeCount),
  });

  revalidatePath("/");
  revalidatePath("/admin/markets");
  return { success: true, marketId };
}

export async function publishMarket(marketId: string) {
  const session = await auth();
  if (!isAdmin(session)) return { error: "Unauthorized" };

  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, marketId))
    .limit(1);

  if (!market) return { error: "Market not found" };
  if (market.status !== "draft") return { error: "Only draft markets can be published" };

  const now = new Date();
  // Default to 72h if no resolution time set
  const resolvesAt = market.resolvesAt ?? new Date(now.getTime() + 72 * 60 * 60 * 1000);
  const haltsAt = new Date(resolvesAt.getTime() - 5 * 60 * 1000);

  await db
    .update(markets)
    .set({
      status: "active",
      opensAt: now,
      haltsAt,
      resolvesAt,
    })
    .where(eq(markets.id, marketId));

  revalidatePath("/");
  revalidatePath("/admin/markets");
  return { success: true };
}

export async function cancelMarket(marketId: string) {
  const session = await auth();
  if (!isAdmin(session)) return { error: "Unauthorized" };

  const result = await db.transaction(async (tx) => {
    const [market] = await tx
      .select()
      .from(markets)
      .where(eq(markets.id, marketId))
      .limit(1);

    if (!market) return { error: "Market not found" } as const;
    if (["resolved", "cancelled", "resolving", "failed"].includes(market.status)) {
      return { error: "Cannot cancel a resolved, resolving, failed, or already cancelled market" } as const;
    }

    await refundPositions(tx, marketId);

    await tx
      .update(markets)
      .set({ status: "cancelled" })
      .where(eq(markets.id, marketId));

    return { success: true } as const;
  });

  if ("success" in result) {
    revalidatePath("/");
    revalidatePath("/admin/markets");
  }
  return result;
}

export async function manualResolve(marketId: string, outcome: number) {
  const session = await auth();
  if (!isAdmin(session)) return { error: "Unauthorized" };

  if (outcome !== 0 && outcome !== 1) return { error: "Invalid outcome" };

  const result = await db.transaction(async (tx) => {
    const [market] = await tx
      .select()
      .from(markets)
      .where(eq(markets.id, marketId))
      .limit(1);

    if (!market) return { error: "Market not found" } as const;
    if (market.status !== "failed" && market.status !== "resolving") {
      return { error: "Can only manually resolve failed or resolving markets" } as const;
    }

    // Set resolved status first to prevent re-entry
    await tx
      .update(markets)
      .set({
        status: "resolved",
        outcome,
        resolvedAt: new Date(),
      })
      .where(eq(markets.id, marketId));

    await distributePayout(tx, marketId, outcome);

    return { success: true } as const;
  });

  if ("success" in result) {
    revalidatePath("/");
    revalidatePath("/admin/markets");
  }
  return result;
}
