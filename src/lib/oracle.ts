import "server-only";

import { db } from "@/db";
import { markets, tiktokPolls } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { distributePayout } from "@/lib/services/payout";

/**
 * Resolve a market that is in "resolving" status.
 * Reads the latest TikTok poll, determines YES/NO outcome, and atomically
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

  const [latestPoll] = await db
    .select({ viewCount: tiktokPolls.viewCount, likeCount: tiktokPolls.likeCount })
    .from(tiktokPolls)
    .where(eq(tiktokPolls.marketId, marketId))
    .orderBy(desc(tiktokPolls.polledAt))
    .limit(1);

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
