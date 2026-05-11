export const dynamic = "force-dynamic";

import { db } from "@/db";
import { markets } from "@/db/schema";
import { desc, eq, or, sql } from "drizzle-orm";
import { DiscoverTabView } from "@/components/DiscoverTabView";

function safePollCount(s: string | null): number | null {
  if (s === null) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n)) {
    console.error(`[poll] count out of safe integer range: ${s} — displaying null`);
    return null;
  }
  return n;
}

export default async function HomePage() {
  // Fetch active/halted/resolving markets — resolved markets live at /resolved
  const activeMarkets = await db
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
    .limit(50);

  // Split feed order: resolving-soon cards first, then active
  const resolvingSoon = activeMarkets.filter(
    (m) => m.status === "halted" || m.status === "resolving"
  );
  const mainMarkets = activeMarkets.filter((m) => m.status === "active");
  const feedMarkets = [...resolvingSoon, ...mainMarkets];

  // Fetch latest poll per market via DISTINCT ON — uses tiktok_polls_market_polled_idx
  let pollData: { marketId: string; viewCount: number | null; likeCount: number | null }[] = [];
  if (feedMarkets.length > 0) {
    const feedIds = feedMarkets.map((m) => m.id);
    // Build ARRAY[$1,$2,...] explicitly — passing a JS array directly produces ($1,$2,...) tuple syntax
    const idsLiteral = sql.join(feedIds.map((id) => sql`${id}`), sql`, `);
    const result = await db.execute(sql`
      SELECT DISTINCT ON (market_id) market_id, view_count, like_count
      FROM tiktok_polls
      WHERE market_id = ANY(ARRAY[${idsLiteral}])
      ORDER BY market_id, polled_at DESC
    `);
    // db.execute returns a QueryResult with a .rows array
    type PollRow = { market_id: string; view_count: string | null; like_count: string | null };
    pollData = (result.rows as PollRow[]).map((r) => ({
      marketId: r.market_id,
      viewCount: safePollCount(r.view_count),
      likeCount: safePollCount(r.like_count),
    }));
  }

  // Trending: top 3 most-recently-created active markets
  const trendingIds = mainMarkets.slice(0, 3).map((m) => m.id);

  // Grid overview shows active/halted/resolving markets only
  const gridMarkets = [...resolvingSoon, ...mainMarkets];

  return (
    <DiscoverTabView
      feedMarkets={feedMarkets}
      gridMarkets={gridMarkets}
      pollData={pollData}
      trendingIds={trendingIds}
    />
  );
}
