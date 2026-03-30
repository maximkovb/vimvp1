"use server";

import { db } from "@/db";
import { markets, priceSnapshots, youtubePolls, tiktokPolls } from "@/db/schema";
import { and, eq, or } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { allPrices } from "@/lib/lmsr";
import { computeMilestoneFloor } from "@/lib/market-utils";
import { computeExpectedOutcome } from "@/lib/calibration";
import { revalidatePath } from "next/cache";
import { distributePayout, refundPositions } from "@/lib/services/payout";
import { YOUTUBE_THUMBNAIL_RE, TIKTOK_THUMBNAIL_RE, YOUTUBE_API_BASE, YT_TIMEOUT_MS } from "@/lib/constants";
import { extractVideoId } from "@/lib/youtube";
import { extractTikTokVideoId, fetchTikTokStatsById, isTikTokUrl } from "@/lib/tiktok";
import { computeMarketSuggestion } from "@/lib/services/marketSuggestion";
import { resolveMarket } from "@/lib/oracle";

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

interface YTListResponse<T> {
  items?: T[];
}

// ─── Actions ─────────────────────────────────────────────────────────────────

// ─── Exported success types ───────────────────────────────────────────────────
// Derived at the type level so client components (page.tsx) don't duplicate shapes manually.

export type VideoStatsSuccess = Exclude<
  Awaited<ReturnType<typeof fetchVideoStats>>,
  { error: string }
>;
export type SuggestionSuccess = Exclude<
  Awaited<ReturnType<typeof generateMarketSuggestion>>,
  { error: string }
>;

/**
 * Phase 1 of two-phase fetch — fast video stats only (~500ms).
 * Returns video metadata without channel analytics or market suggestion.
 * Call generateMarketSuggestion next for the contract recommendation.
 */
export async function fetchVideoStats(url: string) {
  const session = await auth();
  if (!isAdmin(session)) return { error: "Unauthorized" };

  // ── TikTok path ──────────────────────────────────────────────────────────
  if (isTikTokUrl(url)) {
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
      platform: "tiktok" as const,
      videoId,
      tikapiPostId: stats.tikapiPostId,
      title: `@${stats.creatorId}`,
      thumbnail: stats.thumbnailUrl,
      channelTitle: stats.creatorName,
      creatorId: stats.creatorId,
      description: "",
      viewCount: stats.viewCount,
      likeCount: stats.likeCount,
      commentCount: stats.commentCount,
      shareCount: stats.shareCount,
      publishedAt: stats.createdAt,
      categoryId: undefined,
    };
  }

  // ── YouTube path ─────────────────────────────────────────────────────────
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
    platform: "youtube" as const,
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
 * Auth wrapper around computeMarketSuggestion() — session-gated for browser use.
 *
 * Called by: admin UI (session auth).
 * For bearer-token access, POST /api/admin/market-suggestion calls computeMarketSuggestion() directly.
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

  return computeMarketSuggestion(input, apiKey);
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

  const detectedPlatform = isTikTokUrl(videoUrl) ? "tiktok" : "youtube";
  const videoId = detectedPlatform === "tiktok"
    ? extractTikTokVideoId(videoUrl)
    : extractVideoId(videoUrl);
  if (!videoId) return { error: detectedPlatform === "tiktok" ? "Invalid TikTok URL" : "Invalid YouTube URL" };

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

  // channelAvgViews is client-supplied (from Phase 2 suggestion) — clamped but trusted.
  // Falls back to 0, which degrades to velocity-only projection.
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

  // Read video metadata from hidden form fields — avoids re-calling fetchVideoMetadata
  // (which would trigger a second Claude API call)
  const videoTitle = (formData.get("videoTitle") as string) || "";
  const thumbnailRaw = (formData.get("thumbnail") as string) || "";
  const channelTitle = (formData.get("channelTitle") as string) || "";
  const channelId = (formData.get("channelId") as string) || undefined;
  const creatorId = (formData.get("creatorId") as string) || undefined;
  const tikapiPostId = (formData.get("tikapiPostId") as string) || undefined;
  const videoDescriptionRaw = (formData.get("videoDescription") as string) || undefined;
  const videoDescription = videoDescriptionRaw?.slice(0, 5000) || undefined;

  // Only persist thumbnails from known CDN URLs — rejects injected URLs.
  const isValidThumbnail = detectedPlatform === "tiktok"
    ? TIKTOK_THUMBNAIL_RE.test(thumbnailRaw)
    : YOUTUBE_THUMBNAIL_RE.test(thumbnailRaw);
  const thumbnail = isValidThumbnail ? thumbnailRaw : "";

  const now = new Date();
  const hours = resolutionHoursNum;
  const resolvesAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
  const haltsAt = new Date(resolvesAt.getTime() - 5 * 60 * 1000);

  const marketId = crypto.randomUUID();

  await db.insert(markets).values({
    id: marketId,
    videoId,
    platform: detectedPlatform,
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
      ...(channelId ? { channelId } : {}),
      ...(creatorId ? { creatorId } : {}),
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
  if (detectedPlatform === "tiktok") {
    await db.insert(tiktokPolls).values({
      marketId,
      viewCount: BigInt(initialViewCount),
      likeCount: BigInt(initialLikeCount),
      commentCount: null,
      shareCount: null,
    });
  } else {
    await db.insert(youtubePolls).values({
      marketId,
      viewCount: BigInt(initialViewCount),
      likeCount: BigInt(initialLikeCount),
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

/**
 * Quick test market creation — bypasses the two-phase AI suggestion pipeline.
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

  const testPlatform = isTikTokUrl(videoUrl) ? "tiktok" : "youtube";
  const videoId = testPlatform === "tiktok"
    ? extractTikTokVideoId(videoUrl)
    : extractVideoId(videoUrl);
  if (!videoId) return { error: testPlatform === "tiktok" ? "Invalid TikTok URL" : "Invalid YouTube URL" };

  if (!isFinite(milestoneThreshold) || milestoneThreshold < 1) {
    return { error: "Milestone must be at least 1" };
  }

  // Fetch video stats from the appropriate platform
  let viewCount = 0;
  let likeCount = 0;
  let videoTitle = "";
  let thumbnail = "";
  let channelTitle = "";
  let channelId: string | undefined;
  let tikapiPostId: string | undefined;

  if (testPlatform === "tiktok") {
    let stats;
    try {
      stats = await fetchTikTokStatsById(videoId);
    } catch (err) {
      return { error: `TikTok API error: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!stats) return { error: "TikTok video not found or is private" };
    viewCount = stats.viewCount;
    likeCount = stats.likeCount;
    videoTitle = `@${stats.creatorId}`;
    thumbnail = TIKTOK_THUMBNAIL_RE.test(stats.thumbnailUrl) ? stats.thumbnailUrl : "";
    channelTitle = stats.creatorName;
    tikapiPostId = stats.tikapiPostId;
  } else {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) return { error: "YouTube API key not configured" };

    const videoRes = await fetch(
      `${YOUTUBE_API_BASE}/videos?part=snippet,statistics&id=${videoId}&key=${apiKey}&fields=items(snippet(title,thumbnails,channelTitle,channelId),statistics(viewCount,likeCount))`,
      { cache: "no-store", signal: AbortSignal.timeout(YT_TIMEOUT_MS) }
    );

    if (!videoRes.ok) {
      return { error: `YouTube API error: ${videoRes.status}` };
    }

    const videoData: YTListResponse<YTVideoItem> = await videoRes.json();
    if (!videoData.items || videoData.items.length === 0) {
      return { error: "Video not found or is private" };
    }

    const item = videoData.items[0];
    const thumbnailRaw =
      item.snippet.thumbnails?.medium?.url ??
      item.snippet.thumbnails?.default?.url ??
      "";
    videoTitle = item.snippet.title;
    thumbnail = YOUTUBE_THUMBNAIL_RE.test(thumbnailRaw) ? thumbnailRaw : "";
    viewCount = parseInt(item.statistics.viewCount || "0", 10);
    likeCount = parseInt(item.statistics.likeCount || "0", 10);
    channelTitle = item.snippet.channelTitle;
    channelId = item.snippet.channelId;
  }

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
      platform: testPlatform,
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
        ...(channelId ? { channelId } : {}),
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

    if (testPlatform === "tiktok") {
      await tx.insert(tiktokPolls).values({
        marketId,
        viewCount: BigInt(viewCount),
        likeCount: BigInt(likeCount),
        commentCount: null,
        shareCount: null,
      });
    } else {
      await tx.insert(youtubePolls).values({
        marketId,
        viewCount: BigInt(viewCount),
        likeCount: BigInt(likeCount),
      });
    }
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
