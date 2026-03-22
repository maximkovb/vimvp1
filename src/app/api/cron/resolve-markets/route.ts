import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets, youtubePolls } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { distributePayout } from "@/lib/services/payout";
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

  // 3. Resolve RESOLVING markets
  const resolvingMarkets = await db
    .select()
    .from(markets)
    .where(eq(markets.status, "resolving"));

  for (const market of resolvingMarkets) {
    try {
      const outcome = await determineOutcome(market);

      if (outcome === null) {
        await db
          .update(markets)
          .set({ status: "failed" })
          .where(eq(markets.id, market.id));
        results.failed.push(market.id);
        continue;
      }

      // Wrap payout + status update in a single transaction
      await db.transaction(async (tx) => {
        // Set resolved first to prevent re-entry from concurrent cron
        await tx
          .update(markets)
          .set({
            status: "resolved",
            outcome,
            resolvedAt: now,
          })
          .where(and(eq(markets.id, market.id), eq(markets.status, "resolving")));

        await distributePayout(tx, market.id, outcome);
      });

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

async function determineOutcome(
  market: typeof markets.$inferSelect
): Promise<number | null> {
  const [latestPoll] = await db
    .select()
    .from(youtubePolls)
    .where(eq(youtubePolls.marketId, market.id))
    .orderBy(desc(youtubePolls.polledAt))
    .limit(1);

  if (!latestPoll) return null;

  if (latestPoll.viewCount === null || latestPoll.likeCount === null) {
    return 0; // NO — video deleted/private
  }

  const threshold = market.milestoneThreshold;
  const metric =
    market.questionType === "views"
      ? latestPoll.viewCount
      : latestPoll.likeCount;

  return metric >= threshold ? 1 : 0;
}
