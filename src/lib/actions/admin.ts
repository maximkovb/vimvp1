"use server";

import { db } from "@/db";
import { markets, priceSnapshots } from "@/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { allPrices } from "@/lib/lmsr";
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

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

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

export async function fetchVideoMetadata(url: string) {
  const session = await auth();
  if (!isAdmin(session)) return { error: "Unauthorized" };

  const videoId = extractVideoId(url);
  if (!videoId) return { error: "Invalid YouTube URL" };

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { error: "YouTube API key not configured" };

  const res = await fetch(
    `${YOUTUBE_API_BASE}/videos?part=snippet,statistics&id=${videoId}&key=${apiKey}&fields=items(id,snippet(title,thumbnails/medium/url,channelTitle,channelId,publishedAt,categoryId),statistics(viewCount,likeCount))`,
    { cache: "no-store" }
  );

  if (!res.ok) return { error: "YouTube API error" };

  const data = await res.json();
  if (!data.items || data.items.length === 0) {
    return { error: "Video not found or is private" };
  }

  const item = data.items[0];
  const viewCount = parseInt(item.statistics.viewCount || "0");
  const likeCount = parseInt(item.statistics.likeCount || "0");

  // Fetch channel analytics in parallel for risk-tier contract recommendations.
  // If either call fails, fall back gracefully (contract = null).
  let contract: ContractRecommendation | LLMContractRecommendation | null =
    null;
  try {
    const channelId: string = item.snippet.channelId;
    const publishedAt: string = item.snippet.publishedAt;
    const categoryId: string | undefined = item.snippet.categoryId;
    const videoAgeHours = Math.max(
      (Date.now() - new Date(publishedAt).getTime()) / 3_600_000,
      0.1
    );

    const [channelRes, searchRes] = await Promise.all([
      fetch(
        `${YOUTUBE_API_BASE}/channels?part=statistics&id=${channelId}&key=${apiKey}&fields=items(statistics/subscriberCount)`,
        { cache: "no-store" }
      ),
      fetch(
        `${YOUTUBE_API_BASE}/search?part=snippet&channelId=${channelId}&type=video&order=date&maxResults=10&key=${apiKey}`,
        { cache: "no-store" }
      ),
    ]);

    const channelData = channelRes.ok ? await channelRes.json() : null;
    const subscriberCount = Number(
      channelData?.items?.[0]?.statistics?.subscriberCount ?? 0
    );

    let recentViewCounts: number[] = [];
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const recentVideoIds: string[] = (searchData.items ?? [])
        .map((v: { id: { videoId: string } }) => v.id.videoId)
        .filter(Boolean);

      if (recentVideoIds.length > 0) {
        const statsRes = await fetch(
          `${YOUTUBE_API_BASE}/videos?part=statistics&id=${recentVideoIds.join(",")}&key=${apiKey}&fields=items(statistics/viewCount)`,
          { cache: "no-store" }
        );
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          recentViewCounts = (statsData.items ?? []).map(
            (v: { statistics: { viewCount?: string } }) =>
              parseInt(v.statistics.viewCount || "0")
          );
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

    // Compute confidence before try/catch — needed for the algorithmic fallback path
    const confidence = calculateConfidence(videoAgeHours, recentViewCounts);

    const videoContext: VideoContext = {
      videoTitle: item.snippet.title,
      channelName: item.snippet.channelTitle,
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

    // Try LLM, fall back to algorithmic. generateContractPrediction logs before rethrowing.
    try {
      contract = await generateContractPrediction(videoContext);
    } catch {
      // Silent to the user — generateContractPrediction already logged the error type
      contract = calculateContractRecommendations(
        confidence,
        viewCount,
        videoAgeHours,
        recentViewCounts
      );
    }
  } catch {
    // Analytics fetch failed — contract stays null; UI uses static form defaults.
  }

  return {
    videoId,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails.medium.url,
    channelTitle: item.snippet.channelTitle,
    viewCount,
    likeCount,
    contract,
  };
}

export async function createMarket(formData: FormData) {
  const session = await auth();
  if (!isAdmin(session)) return { error: "Unauthorized" };

  const videoUrl = formData.get("videoUrl") as string;
  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const questionType = formData.get("questionType") as "views" | "likes";
  const milestoneThreshold = formData.get("milestoneThreshold") as string;
  const bParameter = formData.get("bParameter") as string;
  const resolutionHours = formData.get("resolutionHours") as string;
  const publishImmediately = formData.get("publishImmediately") === "true";

  if (!videoUrl || !title || !questionType || !milestoneThreshold) {
    return { error: "Required fields missing" };
  }

  const videoId = extractVideoId(videoUrl);
  if (!videoId) return { error: "Invalid YouTube URL" };

  // Read video metadata from hidden form fields — avoids re-calling fetchVideoMetadata
  // (which would trigger a second Claude API call)
  const videoTitle = (formData.get("videoTitle") as string) || "";
  const thumbnail = (formData.get("thumbnail") as string) || "";
  const channelTitle = (formData.get("channelTitle") as string) || "";

  const now = new Date();
  const hours = parseInt(resolutionHours || "72");
  const resolvesAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
  const haltsAt = new Date(resolvesAt.getTime() - 5 * 60 * 1000);
  const b = parseFloat(bParameter || "100");

  const marketId = crypto.randomUUID();

  await db.insert(markets).values({
    id: marketId,
    youtubeVideoId: videoId,
    title,
    description: description || null,
    questionType,
    milestoneThreshold: BigInt(milestoneThreshold),
    bParameter: b.toFixed(2),
    status: publishImmediately ? "active" : "draft",
    videoMetadata: {
      title: videoTitle,
      thumbnail,
      channelTitle,
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
