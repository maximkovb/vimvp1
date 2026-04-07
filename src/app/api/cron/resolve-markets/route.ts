import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets, tiktokPolls } from "@/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { resolveMarket } from "@/lib/oracle";
import { verifyCronAuth } from "@/lib/cron-auth";

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const now = new Date();
  const results: {
    halted: string[];
    resolved: string[];
    failed: string[];
  } = { halted: [], resolved: [], failed: [] };

  // 1. Bulk transition ACTIVE → HALTED (5 min before resolution)
  const haltedRows = await db
    .update(markets)
    .set({ status: "halted" })
    .where(and(eq(markets.status, "active"), sql`${markets.haltsAt} <= ${now}`))
    .returning({ id: markets.id });
  results.halted = haltedRows.map((r) => r.id);

  // 2. Bulk transition HALTED → RESOLVING (at resolution time)
  await db
    .update(markets)
    .set({ status: "resolving" })
    .where(and(eq(markets.status, "halted"), sql`${markets.resolvesAt} <= ${now}`));

  // Safety net: active markets past resolvesAt that missed the halt window
  await db
    .update(markets)
    .set({ status: "resolving" })
    .where(and(eq(markets.status, "active"), sql`${markets.resolvesAt} <= ${now}`));

  // 3. Fetch all resolving markets
  const resolvingMarkets = await db
    .select()
    .from(markets)
    .where(eq(markets.status, "resolving"));

  if (resolvingMarkets.length === 0) {
    return NextResponse.json(results);
  }

  // 4. Batch-fetch the latest poll for each resolving market in one query.
  //    DISTINCT ON (market_id) with ORDER BY market_id, polled_at DESC gives
  //    the most-recent row per market without N separate round-trips.
  const marketIds = resolvingMarkets.map((m) => m.id);
  const latestPollRows = await db.execute<{
    market_id: string;
    view_count: bigint | null;
    like_count: bigint | null;
  }>(sql`
    SELECT DISTINCT ON (market_id) market_id, view_count, like_count
    FROM ${tiktokPolls}
    WHERE market_id = ANY(ARRAY[${sql.join(marketIds.map((id) => sql`${id}`), sql`, `)}]::text[])
    ORDER BY market_id, polled_at DESC
  `);

  const pollMap = new Map(
    latestPollRows.rows.map((r) => [
      r.market_id,
      { viewCount: r.view_count, likeCount: r.like_count },
    ])
  );

  // 5. Resolve each market, passing pre-fetched data to avoid redundant queries
  for (const market of resolvingMarkets) {
    try {
      const latestPoll = pollMap.get(market.id);
      await resolveMarket(market.id, latestPoll ? { market, latestPoll } : undefined);
      results.resolved.push(market.id);
    } catch (error) {
      console.error(`Failed to resolve market ${market.id}:`, error);
      await db
        .update(markets)
        .set({ status: "failed" })
        .where(eq(markets.id, market.id));
      results.failed.push(market.id);
    }
  }

  return NextResponse.json(results);
}
