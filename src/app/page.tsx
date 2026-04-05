import { db } from "@/db";
import { markets, tiktokPolls } from "@/db/schema";
import { desc, eq, or, inArray } from "drizzle-orm";
import { DiscoverFeed } from "@/components/DiscoverFeed";

export default async function HomePage() {
  // Fetch active/halted/resolving + recently resolved markets in parallel
  const [activeMarkets, resolvedMarkets] = await Promise.all([
    db
      .select()
      .from(markets)
      .where(
        or(
          eq(markets.status, "active"),
          eq(markets.status, "halted"),
          eq(markets.status, "resolving")
        )
      )
      .orderBy(desc(markets.createdAt))
      .limit(50),
    db
      .select()
      .from(markets)
      .where(eq(markets.status, "resolved"))
      .orderBy(desc(markets.resolvedAt))
      .limit(12),
  ]);

  // Split feed order: resolving-soon cards first, then active
  const resolvingSoon = activeMarkets.filter(
    (m) => m.status === "halted" || m.status === "resolving"
  );
  const mainMarkets = activeMarkets.filter((m) => m.status === "active");
  const feedMarkets = [...resolvingSoon, ...mainMarkets];

  // Fetch latest tiktokPolls row per market (one batch query, pick first per marketId)
  let pollData: { marketId: string; viewCount: bigint | null; likeCount: bigint | null }[] = [];
  if (feedMarkets.length > 0) {
    const feedIds = feedMarkets.map((m) => m.id);
    const allPolls = await db
      .select({
        marketId: tiktokPolls.marketId,
        viewCount: tiktokPolls.viewCount,
        likeCount: tiktokPolls.likeCount,
      })
      .from(tiktokPolls)
      .where(inArray(tiktokPolls.marketId, feedIds))
      .orderBy(desc(tiktokPolls.polledAt));

    // Keep only the most recent poll per market
    const seen = new Set<string>();
    for (const row of allPolls) {
      if (!seen.has(row.marketId)) {
        seen.add(row.marketId);
        pollData.push(row);
      }
    }
  }

  // Trending: top 3 most-recently-created active markets
  const trendingIds = mainMarkets.slice(0, 3).map((m) => m.id);

  // Grid overview shows all markets (active + resolved)
  const gridMarkets = [...activeMarkets, ...resolvedMarkets];

  return (
    <DiscoverFeed
      feedMarkets={feedMarkets}
      gridMarkets={gridMarkets}
      pollData={pollData}
      trendingIds={trendingIds}
    />
  );
}
