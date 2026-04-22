import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets, tiktokPolls } from "@/db/schema";
import { eq, or, sql, and, lte, asc, desc } from "drizzle-orm";
import { verifyCronAuth } from "@/lib/cron-auth";
import { computeProjectionLabel } from "@/lib/projection";

// GET /api/cron/update-badges — recomputes projection labels for all active/halted markets
// using the latest stored poll data. No TikTok API calls — purely a DB recalculation.
export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const activeMarkets = await db
    .select()
    .from(markets)
    .where(or(eq(markets.status, "active"), eq(markets.status, "halted")));

  if (activeMarkets.length === 0) {
    return NextResponse.json({ updated: 0, skipped: 0 });
  }

  const marketIds = activeMarkets.map((m) => m.id);

  // Fetch the latest poll row for each market in one query.
  const latestPollRows = await db.execute(
    sql`SELECT DISTINCT ON (market_id) market_id, view_count, like_count
        FROM tiktok_polls
        WHERE market_id = ANY(ARRAY[${sql.join(marketIds.map((id) => sql`${id}`), sql`, `)}])
        ORDER BY market_id, polled_at DESC`
  );

  const latestPollByMarket = new Map<
    string,
    { viewCount: bigint | null; likeCount: bigint | null }
  >();
  for (const row of latestPollRows.rows as {
    market_id: string;
    view_count: string | null;
    like_count: string | null;
  }[]) {
    latestPollByMarket.set(row.market_id, {
      viewCount: row.view_count !== null ? BigInt(row.view_count) : null,
      likeCount: row.like_count !== null ? BigInt(row.like_count) : null,
    });
  }

  let updated = 0;
  let skipped = 0;

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  for (const market of activeMarkets) {
    if (!market.resolvesAt) {
      skipped++;
      continue;
    }

    const poll = latestPollByMarket.get(market.id);
    if (!poll) {
      skipped++;
      continue;
    }

    const rawMetric =
      market.questionType === "views" ? poll.viewCount : poll.likeCount;
    if (rawMetric === null) {
      skipped++;
      continue;
    }

    const currentMetric = Number(rawMetric);
    const threshold = Number(market.milestoneThreshold);

    // Prefer a poll from 24h ago; fall back to the oldest available poll.
    const [oldPoll24h] = await db
      .select({ viewCount: tiktokPolls.viewCount, likeCount: tiktokPolls.likeCount, polledAt: tiktokPolls.polledAt })
      .from(tiktokPolls)
      .where(and(eq(tiktokPolls.marketId, market.id), lte(tiktokPolls.polledAt, twentyFourHoursAgo)))
      .orderBy(desc(tiktokPolls.polledAt))
      .limit(1);

    const [oldestPoll] = oldPoll24h
      ? [oldPoll24h]
      : await db
          .select({ viewCount: tiktokPolls.viewCount, likeCount: tiktokPolls.likeCount, polledAt: tiktokPolls.polledAt })
          .from(tiktokPolls)
          .where(eq(tiktokPolls.marketId, market.id))
          .orderBy(asc(tiktokPolls.polledAt))
          .limit(1);

    let rollingVelocityPerHour: number | null = null;
    if (oldestPoll) {
      const windowHours = (Date.now() - new Date(oldestPoll.polledAt).getTime()) / 3_600_000;
      if (windowHours >= 1) {
        const oldMetric = Number(market.questionType === "views" ? oldestPoll.viewCount : oldestPoll.likeCount);
        rollingVelocityPerHour = (currentMetric - oldMetric) / windowHours;
      }
    }

    const label = computeProjectionLabel({
      currentMetric,
      rollingVelocityPerHour,
      milestoneThreshold: threshold,
      resolvesAt: market.resolvesAt,
    });

    await db
      .update(markets)
      .set({ projectionLabel: label })
      .where(eq(markets.id, market.id));

    updated++;
  }

  return NextResponse.json({ updated, skipped });
}
