"use server";

import { db } from "@/db";
import {
  markets,
  positions,
  users,
  coinTransactions,
  priceSnapshots,
} from "@/db/schema";
import { eq, and, ne, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { allPrices } from "@/lib/lmsr";
import { revalidatePath } from "next/cache";

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
  const videoId = extractVideoId(url);
  if (!videoId) return { error: "Invalid YouTube URL" };

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { error: "YouTube API key not configured" };

  const res = await fetch(
    `${YOUTUBE_API_BASE}/videos?part=snippet,statistics&id=${videoId}&key=${apiKey}&fields=items(id,snippet(title,thumbnails/medium/url,channelTitle),statistics(viewCount,likeCount))`,
    { cache: "no-store" }
  );

  if (!res.ok) return { error: "YouTube API error" };

  const data = await res.json();
  if (!data.items || data.items.length === 0) {
    return { error: "Video not found or is private" };
  }

  const item = data.items[0];
  return {
    videoId,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails.medium.url,
    channelTitle: item.snippet.channelTitle,
    viewCount: parseInt(item.statistics.viewCount || "0"),
    likeCount: parseInt(item.statistics.likeCount || "0"),
  };
}

export async function createMarket(formData: FormData) {
  const session = await auth();
  if (!session?.user?.email || session.user.email !== process.env.ADMIN_EMAIL) {
    return { error: "Unauthorized" };
  }

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

  // Fetch video metadata for storage
  const metadata = await fetchVideoMetadata(videoUrl);
  if ("error" in metadata) return { error: metadata.error };

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
      title: metadata.title,
      thumbnail: metadata.thumbnail,
      channelTitle: metadata.channelTitle,
    },
    opensAt: publishImmediately ? now : null,
    haltsAt: publishImmediately ? haltsAt : null,
    resolvesAt: publishImmediately ? resolvesAt : null,
    createdBy: session.user.id!,
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
  if (session?.user?.email !== process.env.ADMIN_EMAIL) {
    return { error: "Unauthorized" };
  }

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
  if (session?.user?.email !== process.env.ADMIN_EMAIL) {
    return { error: "Unauthorized" };
  }

  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, marketId))
    .limit(1);

  if (!market) return { error: "Market not found" };
  if (market.status === "resolved" || market.status === "cancelled") {
    return { error: "Cannot cancel a resolved or already cancelled market" };
  }

  // Refund all positions at cost basis
  const allPositions = await db
    .select()
    .from(positions)
    .where(
      and(eq(positions.marketId, marketId), ne(positions.shares, "0"))
    );

  for (const position of allPositions) {
    const shares = parseFloat(position.shares);
    const avgCost = parseFloat(position.avgCostBasis);
    const refundAmount = shares * avgCost;

    if (refundAmount > 0) {
      // Credit user balance
      await db
        .update(users)
        .set({
          balance: sql`${users.balance} + ${refundAmount.toFixed(2)}`,
        })
        .where(eq(users.id, position.userId));

      // Log refund
      await db.insert(coinTransactions).values({
        userId: position.userId,
        amount: refundAmount.toFixed(2),
        type: "refund",
        referenceId: marketId,
      });

      // Zero out position
      await db
        .update(positions)
        .set({ shares: "0" })
        .where(eq(positions.id, position.id));
    }
  }

  await db
    .update(markets)
    .set({ status: "cancelled" })
    .where(eq(markets.id, marketId));

  revalidatePath("/");
  revalidatePath("/admin/markets");
  return { success: true };
}

export async function manualResolve(marketId: string, outcome: number) {
  const session = await auth();
  if (session?.user?.email !== process.env.ADMIN_EMAIL) {
    return { error: "Unauthorized" };
  }

  if (outcome !== 0 && outcome !== 1) return { error: "Invalid outcome" };

  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, marketId))
    .limit(1);

  if (!market) return { error: "Market not found" };
  if (market.status !== "failed" && market.status !== "resolving") {
    return { error: "Can only manually resolve failed or resolving markets" };
  }

  // Distribute payouts
  const winningPositions = await db
    .select()
    .from(positions)
    .where(
      and(
        eq(positions.marketId, marketId),
        eq(positions.outcome, outcome),
        ne(positions.shares, "0")
      )
    );

  for (const position of winningPositions) {
    const shares = parseFloat(position.shares);
    const payout = shares; // 1 coin per winning share

    // Check idempotency — don't pay out twice
    const [existing] = await db
      .select({ id: coinTransactions.id })
      .from(coinTransactions)
      .where(
        and(
          eq(coinTransactions.userId, position.userId),
          eq(coinTransactions.referenceId, marketId),
          eq(coinTransactions.type, "payout")
        )
      )
      .limit(1);

    if (existing) continue;

    await db
      .update(users)
      .set({
        balance: sql`${users.balance} + ${payout.toFixed(2)}`,
      })
      .where(eq(users.id, position.userId));

    await db.insert(coinTransactions).values({
      userId: position.userId,
      amount: payout.toFixed(2),
      type: "payout",
      referenceId: marketId,
    });
  }

  await db
    .update(markets)
    .set({
      status: "resolved",
      outcome,
      resolvedAt: new Date(),
    })
    .where(eq(markets.id, marketId));

  revalidatePath("/");
  revalidatePath("/admin/markets");
  return { success: true };
}
