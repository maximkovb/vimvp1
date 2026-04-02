import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets, tiktokPolls } from "@/db/schema";
import { and, or, eq, sql } from "drizzle-orm";
import { verifyCronAuth } from "@/lib/cron-auth";
import { fetchTikTokStatsById } from "@/lib/tiktok";
import { TIKTOK_THUMBNAIL_RE } from "@/lib/constants";
import { resolveMarket } from "@/lib/oracle";

export const maxDuration = 60;

/**
 * Returns true if the market is due for a new TikTok poll.
 * Polls every 10 minutes for all active and halted TikTok markets.
 */
function shouldPoll(
  market: { resolvesAt: Date | null; status: string },
  lastPollAt: Date | null
): boolean {
  if (!market.resolvesAt) return false;
  if (market.status !== "active" && market.status !== "halted") return false;
  if (!lastPollAt) return true;
  return Date.now() - lastPollAt.getTime() >= 10 * 60 * 1000;
}

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  // Fetch active and halted TikTok markets only
  const activeMarkets = await db
    .select()
    .from(markets)
    .where(or(eq(markets.status, "active"), eq(markets.status, "halted")));

  if (activeMarkets.length === 0) {
    return NextResponse.json({ polled: 0 });
  }

  // Get last poll time for each market
  const marketIds = activeMarkets.map((m) => m.id);
  const lastPollRows = await db.execute(
    sql`SELECT market_id, MAX(polled_at) as last_polled_at FROM tiktok_polls WHERE market_id = ANY(ARRAY[${sql.join(marketIds.map((id) => sql`${id}`), sql`, `)}]) GROUP BY market_id`
  );

  const lastPollByMarket = new Map<string, Date>();
  for (const row of lastPollRows.rows as {
    market_id: string;
    last_polled_at: Date;
  }[]) {
    lastPollByMarket.set(row.market_id, row.last_polled_at);
  }

  const marketsToPoll = activeMarkets.filter((m) =>
    shouldPoll(m, lastPollByMarket.get(m.id) ?? null)
  );

  if (marketsToPoll.length === 0) {
    return NextResponse.json({ polled: 0, skipped: activeMarkets.length });
  }

  let polledCount = 0;
  let earlyResolvedCount = 0;
  const errors: string[] = [];
  const resolveErrors: string[] = [];

  for (const market of marketsToPoll) {
    try {
      const stats = await fetchTikTokStatsById(market.videoId);

      await db.insert(tiktokPolls).values({
        marketId: market.id,
        viewCount: stats !== null ? BigInt(stats.viewCount) : null,
        likeCount: stats !== null ? BigInt(stats.likeCount) : null,
      });

      // Update videoMetadata thumbnail if TikTok CDN URL changed (signed URLs rotate).
      // Only persist URLs from the known TikTok CDN domain to prevent injection.
      if (stats?.thumbnailUrl && TIKTOK_THUMBNAIL_RE.test(stats.thumbnailUrl)) {
        await db
          .update(markets)
          .set({
            videoMetadata: {
              ...(market.videoMetadata ?? { title: "", channelTitle: "" }),
              thumbnail: stats.thumbnailUrl,
            },
          })
          .where(eq(markets.id, market.id));
      }

      // Auto-resolve if milestone crossed
      if (stats !== null) {
        const metric =
          market.questionType === "views"
            ? BigInt(stats.viewCount)
            : BigInt(stats.likeCount);

        if (metric >= market.milestoneThreshold) {
          try {
            // Only proceed if the status transition succeeds (guards against already-resolved markets)
            const transitioned = await db
              .update(markets)
              .set({ status: "resolving" })
              .where(
                and(
                  eq(markets.id, market.id),
                  or(eq(markets.status, "active"), eq(markets.status, "halted"))
                )
              )
              .returning({ id: markets.id });

            if (transitioned.length > 0) {
              await resolveMarket(market.id);
              earlyResolvedCount++;
            }
          } catch (resolveErr) {
            const msg = resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
            console.error(`Early resolve failed for market ${market.id}:`, msg);
            resolveErrors.push(`${market.id}: ${msg}`);
          }
        }
      }

      polledCount++;

      // Rate limit: ~1 req/sec to stay under TikAPI's 60 req/min basic limit
      await new Promise((r) => setTimeout(r, 1100));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`TikTok poll failed for market ${market.id}:`, msg);
      errors.push(`${market.id}: ${msg}`);
      // Continue to next market — don't abort the whole cron on one failure
    }
  }

  return NextResponse.json({
    polled: polledCount,
    skipped: activeMarkets.length - marketsToPoll.length,
    earlyResolved: earlyResolvedCount > 0 ? earlyResolvedCount : undefined,
    errors: errors.length > 0 ? errors : undefined,
    resolveErrors: resolveErrors.length > 0 ? resolveErrors : undefined,
  });
}
