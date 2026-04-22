import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { or, eq, sql } from "drizzle-orm";

// GET /api/feed/polls — latest view/like counts for every active/halted/resolving market.
// No auth required. Used by DiscoverFeed to refresh ProgressRing data on the client.
export const dynamic = "force-dynamic";

export async function GET() {
  const activeMarkets = await db
    .select({ id: markets.id })
    .from(markets)
    .where(
      or(
        eq(markets.status, "active"),
        eq(markets.status, "halted"),
        eq(markets.status, "resolving")
      )
    );

  if (activeMarkets.length === 0) {
    return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
  }

  const ids = activeMarkets.map((m) => m.id);
  const idsLiteral = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  );

  const result = await db.execute(sql`
    SELECT DISTINCT ON (market_id) market_id, view_count, like_count
    FROM tiktok_polls
    WHERE market_id = ANY(ARRAY[${idsLiteral}])
    ORDER BY market_id, polled_at DESC
  `);

  type PollRow = { market_id: string; view_count: string | null; like_count: string | null };
  const polls = (result.rows as PollRow[]).map((r) => ({
    marketId: r.market_id,
    viewCount: r.view_count !== null ? Number(r.view_count) : null,
    likeCount: r.like_count !== null ? Number(r.like_count) : null,
  }));

  return NextResponse.json(polls, { headers: { "Cache-Control": "no-store" } });
}
