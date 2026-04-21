import "server-only";

import { db } from "@/db";
import { markets, youtubePolls, tiktokPolls } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { distributePayout } from "@/lib/services/payout";
import { YOUTUBE_API_BASE, YT_TIMEOUT_MS } from "@/lib/constants";

interface YouTubeStatsResponse {
  items?: Array<{
    statistics: {
      viewCount?: string;
      likeCount?: string;
    };
  }>;
}

/**
 * Fetch view and like counts for a single YouTube video.
 * Returns null if the video is deleted or private (stats absent from response).
 * Throws on network or API error — callers decide whether to continue or fail.
 */
export async function fetchYouTubeStats(
  videoId: string
): Promise<{ viewCount: number; likeCount: number; timestamp: Date } | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY not configured");

  const res = await fetch(
    `${YOUTUBE_API_BASE}/videos?part=statistics&id=${encodeURIComponent(videoId)}&key=${apiKey}&fields=items(statistics(viewCount,likeCount))`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(YT_TIMEOUT_MS),
    }
  );

  if (!res.ok) {
    throw new Error(`YouTube API error: ${res.status} ${await res.text()}`);
  }

  const data: YouTubeStatsResponse = await res.json();
  const item = data.items?.[0];

  // Video deleted, private, or not found — no item in response
  if (!item) return null;

  return {
    viewCount: parseInt(item.statistics.viewCount ?? "0", 10),
    likeCount: parseInt(item.statistics.likeCount ?? "0", 10),
    timestamp: new Date(),
  };
}

/**
 * Resolve a market that is in "resolving" status.
 * Reads the latest poll, determines YES/NO outcome, and atomically
 * updates market status + distributes payouts in a single transaction.
 *
 * Idempotent: the WHERE clause guards on status="resolving" so concurrent
 * cron invocations cannot double-resolve.
 *
 * Throws if no poll data is available or a DB error occurs.
 */
export async function resolveMarket(marketId: string): Promise<void> {
  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, marketId))
    .limit(1);

  if (!market) throw new Error(`Market ${marketId} not found`);

  // Platform-aware poll lookup
  let latestPoll: { viewCount: bigint | null; likeCount: bigint | null } | undefined;

  if (market.platform === "tiktok") {
    const [poll] = await db
      .select()
      .from(tiktokPolls)
      .where(eq(tiktokPolls.marketId, marketId))
      .orderBy(desc(tiktokPolls.polledAt))
      .limit(1);
    latestPoll = poll;
  } else {
    const [poll] = await db
      .select()
      .from(youtubePolls)
      .where(eq(youtubePolls.marketId, marketId))
      .orderBy(desc(youtubePolls.polledAt))
      .limit(1);
    latestPoll = poll;
  }

  if (!latestPoll) throw new Error(`No poll data for market ${marketId}`);

  // Null counts mean video was deleted/private → resolve NO
  const metric =
    market.questionType === "views"
      ? latestPoll.viewCount
      : latestPoll.likeCount;

  const outcome =
    metric !== null && metric >= market.milestoneThreshold ? 1 : 0;

  const now = new Date();

  await db.transaction(async (tx) => {
    // Idempotency guard: only update if still in "resolving" status
    await tx
      .update(markets)
      .set({ status: "resolved", outcome, resolvedAt: now })
      .where(and(eq(markets.id, marketId), eq(markets.status, "resolving")));

    await distributePayout(tx, marketId, outcome);
  });
}
