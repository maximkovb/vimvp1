import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets, youtubePolls } from "@/db/schema";
import { or, eq, sql } from "drizzle-orm";
import { verifyCronAuth } from "@/lib/cron-auth";

import { YOUTUBE_API_BASE } from "@/lib/constants";

interface YouTubeVideoListResponse {
  items?: Array<{
    id: string;
    statistics: {
      viewCount?: string;
      likeCount?: string;
    };
  }>;
}

/**
 * Returns true if the market is due for a new poll.
 * All active and halted markets poll every 5 minutes regardless of time until
 * resolution, so the view trajectory chart never shows data older than ~10 minutes.
 */
function shouldPoll(
  market: { resolvesAt: Date | null; status: string },
  lastPollAt: Date | null
): boolean {
  if (!market.resolvesAt) return false;
  if (market.status !== "active" && market.status !== "halted") return false;
  if (!lastPollAt) return true;
  return Date.now() - lastPollAt.getTime() >= 5 * 60 * 1000;
}

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "YouTube API key not configured" },
      { status: 500 }
    );
  }

  // Fetch active and halted markets
  const activeMarkets = await db
    .select()
    .from(markets)
    .where(
      or(eq(markets.status, "active"), eq(markets.status, "halted"))
    );

  if (activeMarkets.length === 0) {
    return NextResponse.json({ polled: 0 });
  }

  // Get last poll time for each market (GROUP BY to avoid fetching full history)
  const marketIds = activeMarkets.map((m) => m.id);
  const lastPollRows = await db.execute(
    sql`SELECT market_id, MAX(polled_at) as last_polled_at FROM youtube_polls WHERE market_id = ANY(ARRAY[${sql.join(marketIds.map(id => sql`${id}`), sql`, `)}]) GROUP BY market_id`
  );

  const lastPollByMarket = new Map<string, Date>();
  for (const row of lastPollRows.rows as { market_id: string; last_polled_at: Date }[]) {
    lastPollByMarket.set(row.market_id, row.last_polled_at);
  }

  // Filter to markets that need polling based on adaptive tier
  const marketsToPoll = activeMarkets.filter((m) =>
    shouldPoll(m, lastPollByMarket.get(m.id) ?? null)
  );

  if (marketsToPoll.length === 0) {
    return NextResponse.json({ polled: 0, skipped: activeMarkets.length });
  }

  // Batch YouTube API calls (max 50 IDs per request)
  const videoIds = [...new Set(marketsToPoll.map((m) => m.youtubeVideoId))];
  const batches: string[][] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    batches.push(videoIds.slice(i, i + 50));
  }

  const videoStats = new Map<
    string,
    { viewCount: bigint; likeCount: bigint }
  >();

  for (const batch of batches) {
    const res = await fetch(
      `${YOUTUBE_API_BASE}/videos?part=statistics&id=${batch.join(",")}&key=${apiKey}&fields=items(id,statistics(viewCount,likeCount))`,
      { cache: "no-store" }
    );

    if (!res.ok) {
      console.error("YouTube API error:", res.status, await res.text());
      continue;
    }

    const data: YouTubeVideoListResponse = await res.json();
    for (const item of data.items ?? []) {
      videoStats.set(item.id, {
        viewCount: BigInt(item.statistics.viewCount || "0"),
        likeCount: BigInt(item.statistics.likeCount || "0"),
      });
    }

    // Videos not in the response are deleted/private — store nulls
    for (const id of batch) {
      if (!videoStats.has(id)) {
        videoStats.set(id, { viewCount: BigInt(-1), likeCount: BigInt(-1) });
      }
    }
  }

  // Store poll results
  const pollRecords = marketsToPoll
    .map((market) => {
      const stats = videoStats.get(market.youtubeVideoId);
      if (!stats) return null;

      const isDeleted = stats.viewCount === BigInt(-1);
      return {
        marketId: market.id,
        viewCount: isDeleted ? null : stats.viewCount,
        likeCount: isDeleted ? null : stats.likeCount,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (pollRecords.length > 0) {
    await db.insert(youtubePolls).values(pollRecords);
  }

  return NextResponse.json({
    polled: pollRecords.length,
    skipped: activeMarkets.length - marketsToPoll.length,
  });
}
