"use server";

import { db } from "@/db";
import { markets, priceSnapshots, tiktokPolls } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { allPrices } from "@/lib/lmsr";
import { computeMilestoneFloor } from "@/lib/market-utils";
import { computeExpectedOutcome } from "@/lib/calibration";
import { revalidatePath } from "next/cache";
import { distributePayout, refundPositions } from "@/lib/services/payout";
import { TIKTOK_THUMBNAIL_RE } from "@/lib/constants";
import { extractTikTokVideoId, fetchTikTokStatsById } from "@/lib/tiktok";
import { resolveMarket } from "@/lib/oracle";
import { computeMarketSuggestion, type MarketSuggestionInput } from "@/lib/services/marketSuggestion";

// ─── Exported success types ───────────────────────────────────────────────────
// Derived at the type level so client components (page.tsx) don't duplicate shapes manually.

export type VideoStatsSuccess = Exclude<
  Awaited<ReturnType<typeof fetchVideoStats>>,
  { error: string }
>;

export type MarketSuggestionSuccess = Exclude<
  Awaited<ReturnType<typeof fetchMarketSuggestion>>,
  { error: string }
>;

/**
 * Phase 2 fetch — contract suggestion based on video stats (~200ms, DB + local computation).
 * Returns algorithmic contract recommendation (milestone, resolution window, risk tier).
 */
export async function fetchMarketSuggestion(input: MarketSuggestionInput) {
  const session = await auth();
  if (!isAdmin(session)) return { error: "Unauthorized" };
  try {
    return await computeMarketSuggestion(input);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Suggestion failed" };
  }
}

/**
 * Phase 1 fetch — fast TikTok video stats only (~500ms).
 * Returns video metadata without market suggestion.
 */
export async function fetchVideoStats(url: string) {
  const session = await auth();
  if (!isAdmin(session)) return { error: "Unauthorized" };

  const videoId = extractTikTokVideoId(url);
  if (!videoId) return { error: "Invalid TikTok URL — use a full URL like https://www.tiktok.com/@user/video/1234567890" };

  let stats;
  try {
    stats = await fetchTikTokStatsById(videoId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `TikTok API error: ${msg}` };
  }

  if (!stats) return { error: "TikTok video not found or is private" };

  return {
    videoId,
    tikapiPostId: stats.tikapiPostId,
    title: `@${stats.creatorId}`,
    thumbnail: stats.thumbnailUrl,
    channelTitle: stats.creatorName,
    creatorId: stats.creatorId,
    description: "",
    playUrl: stats.playUrl,
    viewCount: stats.viewCount,
    likeCount: stats.likeCount,
    commentCount: stats.commentCount,
    shareCount: stats.shareCount,
    publishedAt: stats.createdAt,
  };
}

export async function createMarket(formData: FormData) {
  const session = await auth();
  if (!isAdmin(session)) return { error: "Unauthorized" };

  const videoUrl = (formData.get("videoUrl") ?? "") as string;
  const title = (formData.get("title") ?? "") as string;
  const description = (formData.get("description") ?? "") as string;
  const questionType = (formData.get("questionType") ?? "") as string;
  const milestoneThresholdRaw = (formData.get("milestoneThreshold") ?? "") as string;
  const bParameterRaw = (formData.get("bParameter") ?? "") as string;
  const resolutionHours = (formData.get("resolutionHours") ?? "") as string;
  // The admin UI always sets publishImmediately=true (checkbox removed).
  // This field is preserved so the POST /api/markets agent route can still create drafts.
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

  const videoId = extractTikTokVideoId(videoUrl);
  if (!videoId) return { error: "Invalid TikTok URL — paste a full tiktok.com/@user/video/... URL" };

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

  // Floor guard — milestone must exceed what the video typically achieves in the window.
  // Number() correctly parses scientific notation ("1e6" → 1000000); parseInt would truncate to 1.
  const initialViewCount = Math.round(Number((formData.get("initialViewCount") ?? "") as string));
  const initialLikeCount = Math.round(Number((formData.get("initialLikeCount") ?? "") as string));
  if (!isFinite(initialViewCount) || !isFinite(initialLikeCount) ||
      initialViewCount < 0 || initialLikeCount < 0) {
    return { error: "initialViewCount and initialLikeCount are required" };
  }
  const initialCount = validatedQuestionType === "views" ? initialViewCount : initialLikeCount;

  // channelAvgViews falls back to 0, which degrades to velocity-only projection.
  const channelAvgViews = Math.max(
    0,
    Math.round(Number((formData.get("channelAvgViews") ?? "0") as string))
  );

  // videoAgeHours is re-derived server-side from publishedAt to prevent client manipulation
  // and to use the age at submit time rather than suggestion time.
  // Falls back to 1h if publishedAt is absent or unparseable.
  const publishedAtStr = (formData.get("publishedAt") ?? "") as string;
  const videoAgeHoursVal =
    publishedAtStr && !isNaN(Date.parse(publishedAtStr))
      ? Math.max((Date.now() - new Date(publishedAtStr).getTime()) / 3_600_000, 0.1)
      : 1;

  // Validate resolutionHours before using it in any computation.
  const resolutionHoursNum = parseInt(resolutionHours || "");
  if (![24, 48, 72].includes(resolutionHoursNum) || isNaN(resolutionHoursNum)) {
    return { error: "resolutionHours must be 24, 48, or 72" };
  }

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

  // Read video metadata from hidden form fields — avoids re-calling fetchVideoStats
  const videoTitle = (formData.get("videoTitle") as string) || "";
  const thumbnailRaw = (formData.get("thumbnail") as string) || "";
  const channelTitle = (formData.get("channelTitle") as string) || "";
  const creatorId = (formData.get("creatorId") as string) || undefined;
  const tikapiPostId = (formData.get("tikapiPostId") as string) || undefined;
  const videoDescriptionRaw = (formData.get("videoDescription") as string) || undefined;
  const videoDescription = videoDescriptionRaw?.slice(0, 5000) || undefined;
  const playUrlRaw = (formData.get("playUrl") as string) || undefined;

  // Only persist thumbnails from known TikTok CDN URLs — rejects injected URLs.
  const thumbnail = TIKTOK_THUMBNAIL_RE.test(thumbnailRaw) ? thumbnailRaw : "";

  const now = new Date();
  const hours = resolutionHoursNum;
  const resolvesAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
  const haltsAt = new Date(resolvesAt.getTime() - 5 * 60 * 1000);

  const marketId = crypto.randomUUID();

  await db.insert(markets).values({
    id: marketId,
    videoId,
    ...(tikapiPostId ? { tikapiPostId } : {}),
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
      ...(creatorId ? { creatorId } : {}),
      ...(videoDescription ? { description: videoDescription } : {}),
      ...(playUrlRaw ? { playUrl: playUrlRaw } : {}),
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

  // Insert initial poll row with the already-validated view/like counts.
  await db.insert(tiktokPolls).values({
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

/**
 * Quick test market creation — bypasses the AI suggestion pipeline.
 * Uses b=0.01 and a fixed 48h resolution window for fast oracle testing.
 * Admin-only.
 */
export async function createTestMarket(
  videoUrl: string,
  milestoneThreshold: number,
  questionType: "views" | "likes",
  contractTitle: string
) {
  const session = await auth();
  if (!isAdmin(session)) return { error: "Unauthorized" };

  const videoId = extractTikTokVideoId(videoUrl);
  if (!videoId) return { error: "Invalid TikTok URL — paste a full tiktok.com/@user/video/... URL" };

  if (!isFinite(milestoneThreshold) || milestoneThreshold < 1) {
    return { error: "Milestone must be at least 1" };
  }

  let stats;
  try {
    stats = await fetchTikTokStatsById(videoId);
  } catch (err) {
    return { error: `TikTok API error: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!stats) return { error: "TikTok video not found or is private" };

  const viewCount = stats.viewCount;
  const likeCount = stats.likeCount;
  const videoTitle = `@${stats.creatorId}`;
  const thumbnail = TIKTOK_THUMBNAIL_RE.test(stats.thumbnailUrl) ? stats.thumbnailUrl : "";
  const channelTitle = stats.creatorName;
  const tikapiPostId = stats.tikapiPostId;
  const playUrl = stats.playUrl || undefined;

  const now = new Date();
  const resolvesAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const haltsAt = new Date(resolvesAt.getTime() - 5 * 60 * 1000);
  const b = 0.01;
  const prices = allPrices([0, 0], b);
  const marketId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(markets).values({
      id: marketId,
      videoId,
      ...(tikapiPostId ? { tikapiPostId } : {}),
      title: contractTitle.trim(),
      questionType,
      milestoneThreshold: BigInt(Math.round(milestoneThreshold)),
      bParameter: b.toFixed(2),
      status: "active",
      videoMetadata: {
        title: videoTitle,
        thumbnail,
        channelTitle,
        ...(playUrl ? { playUrl } : {}),
      },
      opensAt: now,
      haltsAt,
      resolvesAt,
      createdBy: session!.user!.id!,
    });

    await tx.insert(priceSnapshots).values({
      marketId,
      priceYes: prices[0].toFixed(6),
      priceNo: prices[1].toFixed(6),
    });

    await tx.insert(tiktokPolls).values({
      marketId,
      viewCount: BigInt(viewCount),
      likeCount: BigInt(likeCount),
    });
  });

  revalidatePath("/");
  revalidatePath("/admin/markets");
  return { success: true as const, marketId };
}

/**
 * Force-resolve a market via the oracle using the latest poll data.
 * For testing: works on active/halted markets, not just resolving/failed.
 * Transitions status to "resolving" then calls resolveMarket() from oracle.
 * Admin-only.
 */
export async function resolveNow(marketId: string) {
  const session = await auth();
  if (!isAdmin(session)) return { error: "Unauthorized" };

  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, marketId))
    .limit(1);

  if (!market) return { error: "Market not found" };

  const finalStatuses = ["resolved", "cancelled"];
  if (finalStatuses.includes(market.status)) {
    return { error: `Market is already ${market.status}` };
  }

  // Transition to "resolving" so the oracle's idempotency guard passes
  await db
    .update(markets)
    .set({ status: "resolving" })
    .where(and(eq(markets.id, marketId), eq(markets.status, market.status)));

  try {
    await resolveMarket(marketId);
  } catch (err) {
    // If oracle fails (e.g., no poll data), surface a clear message
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }

  revalidatePath("/");
  revalidatePath("/admin/markets");
  return { success: true as const };
}
