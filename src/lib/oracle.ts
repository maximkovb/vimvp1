import "server-only";

import { db } from "@/db";
import { markets, tiktokPolls } from "@/db/schema";
import { eq, and, gte } from "drizzle-orm";
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

  // Require at least one poll to exist (guards against no-data error)
  const [anyPoll] = await db
    .select({ id: tiktokPolls.id })
    .from(tiktokPolls)
    .where(eq(tiktokPolls.marketId, marketId))
    .limit(1);

  if (!anyPoll) throw new Error(`No poll data for market ${marketId}`);

  // YES if the milestone was EVER crossed in any recorded poll.
  // Uses a predicate query across all polls rather than the latest-only row —
  // TikTok routinely normalizes counts downward after spikes, so "latest poll"
  // can show below-threshold even after the milestone was legitimately crossed.
  // NULL counts (deleted/private video) do not satisfy gte → resolve NO correctly.
  const metricColumn =
    market.questionType === "views" ? tiktokPolls.viewCount : tiktokPolls.likeCount;

  const [crossedPoll] = await db
    .select({ id: tiktokPolls.id })
    .from(tiktokPolls)
    .where(and(eq(tiktokPolls.marketId, marketId), gte(metricColumn, market.milestoneThreshold)))
    .limit(1);

  // 0=YES (milestone ever met), 1=NO — matches schema convention
  const outcome = crossedPoll !== undefined ? 0 : 1;

  const now = new Date();

  await db.transaction(async (tx) => {
    // Idempotency guard: only update if still in "resolving" status.
    // Check affected rows before distributing payouts — concurrent resolution
    // leaves 0 rows updated, and calling distributePayout in that case would
    // pay winners for whatever outcome THIS run computed, not the winning one.
    const updated = await tx
      .update(markets)
      .set({ status: "resolved", outcome, resolvedAt: now })
      .where(and(eq(markets.id, marketId), eq(markets.status, "resolving")))
      .returning({ id: markets.id });

    if (updated.length === 0) return;

    await distributePayout(tx, marketId, outcome);
  });
}
