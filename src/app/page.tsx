import { db } from "@/db";
import { markets } from "@/db/schema";
import { desc, eq, or, sql } from "drizzle-orm";
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

  // Fetch latest poll per market via DISTINCT ON — uses tiktok_polls_market_polled_idx
  let pollData: { marketId: string; viewCount: bigint | null; likeCount: bigint | null }[] = [];
  if (feedMarkets.length > 0) {
    const feedIds = feedMarkets.map((m) => m.id);
    const result = await db.execute(sql`
      SELECT DISTINCT ON (market_id) market_id, view_count, like_count
      FROM tiktok_polls
      WHERE market_id = ANY(${feedIds})
      ORDER BY market_id, polled_at DESC
    `);
    // db.execute returns a QueryResult with a .rows array
    type PollRow = { market_id: string; view_count: string | null; like_count: string | null };
    pollData = (result.rows as PollRow[]).map((r) => ({
      marketId: r.market_id,
      viewCount: r.view_count !== null ? BigInt(r.view_count) : null,
      likeCount: r.like_count !== null ? BigInt(r.like_count) : null,
    }));
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
