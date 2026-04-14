import { db } from "@/db";
import { markets, tiktokPolls } from "@/db/schema";
import { and, or, eq, sql } from "drizzle-orm";
import { fetchTikTokStatsById } from "@/lib/tiktok";
import { TIKTOK_THUMBNAIL_RE, TIKTOK_PLAY_URL_RE } from "@/lib/constants";
import { resolveMarket } from "@/lib/oracle";

export interface PollResult {
  polled: number;
  nullStats?: number;
  skipped: number;
  earlyResolved?: number;
  errors?: string[];
  resolveErrors?: string[];
  details: { id: string; videoId: string; views: number | null; likes: number | null }[];
  skipReasons?: {
    id: string;
    status: string;
    hasResolvesAt: boolean;
    lastPollMinsAgo: number | null;
    reason: string;
  }[];
}

/**
 * Returns true if the market is due for a new TikTok poll.
 * Polls every ~10 minutes for all active and halted TikTok markets.
 */
function shouldPoll(
  market: { resolvesAt: Date | null; status: string },
  lastPollAt: Date | null
): boolean {
  if (!market.resolvesAt) return false;
  if (market.status !== "active" && market.status !== "halted") return false;
  if (!lastPollAt) return true;
  // 9-min threshold: the Vercel cron fires every 10 min (*/10 in vercel.json) but each poll
  // completes a few seconds after the cron tick, so lastPollAt is always slightly ahead of
  // the next tick. 9 min absorbs this drift while still blocking genuine rapid duplicates.
  // Do not "correct" this to 10 min — the intentional mismatch is the fix.
  return Date.now() - lastPollAt.getTime() >= 9 * 60 * 1000;
}

/**
 * Polls TikTok stats for all active and halted markets.
 * Called directly by instrumentation.ts on server startup and by the Vercel cron route.
 *
 * @param force - Skip the 9-minute cooldown guard and poll all eligible markets immediately.
 */
export async function pollAllActiveMarkets(force = false): Promise<PollResult> {
  const activeMarkets = await db
    .select()
    .from(markets)
    .where(or(eq(markets.status, "active"), eq(markets.status, "halted")));

  if (activeMarkets.length === 0) {
    return { polled: 0, skipped: 0, details: [] };
  }

  // Get last poll time for each market.
  // Use EXTRACT(EPOCH) to return Unix milliseconds — avoids timezone ambiguity when
  // Neon returns plain TIMESTAMP strings that new Date() would misparse as local time.
  const marketIds = activeMarkets.map((m) => m.id);
  const lastPollRows = await db.execute(
    sql`SELECT market_id, EXTRACT(EPOCH FROM MAX(polled_at))::bigint * 1000 AS last_polled_ms FROM tiktok_polls WHERE market_id = ANY(ARRAY[${sql.join(marketIds.map((id) => sql`${id}`), sql`, `)}]) GROUP BY market_id`
  );

  const lastPollByMarket = new Map<string, Date>();
  for (const row of lastPollRows.rows as {
    market_id: string;
    last_polled_ms: string | number | bigint;
  }[]) {
    lastPollByMarket.set(row.market_id, new Date(Number(row.last_polled_ms)));
  }

  const marketsToPoll = force
    ? activeMarkets
    : activeMarkets.filter((m) => shouldPoll(m, lastPollByMarket.get(m.id) ?? null));

  if (marketsToPoll.length === 0) {
    // Debug: show why each market was skipped
    const skipReasons = activeMarkets.map((m) => {
      const lastPollAt = lastPollByMarket.get(m.id) ?? null;
      const minsAgo = lastPollAt ? Math.round((Date.now() - lastPollAt.getTime()) / 60000) : null;
      return {
        id: m.id.slice(0, 8),
        status: m.status,
        hasResolvesAt: !!m.resolvesAt,
        lastPollMinsAgo: minsAgo,
        reason: !m.resolvesAt
          ? "no resolvesAt"
          : minsAgo !== null && minsAgo < 9
          ? `only ${minsAgo}m ago`
          : "unknown",
      };
    });
    return { polled: 0, skipped: activeMarkets.length, skipReasons, details: [] };
  }

  let polledCount = 0;
  let nullStatsCount = 0;
  let earlyResolvedCount = 0;
  const errors: string[] = [];
  const resolveErrors: string[] = [];
  const details: { id: string; videoId: string; views: number | null; likes: number | null }[] =
    [];

  for (const market of marketsToPoll) {
    try {
      const stats = await fetchTikTokStatsById(market.videoId);

      // Only persist a poll row when we have real data — null rows (TikWM failure,
      // deleted/private video) would poison pollHistory and blank the UI.
      if (stats !== null) {
        await db.insert(tiktokPolls).values({
          marketId: market.id,
          viewCount: BigInt(stats.viewCount),
          likeCount: BigInt(stats.likeCount),
        });
        details.push({
          id: market.id.slice(0, 8),
          videoId: market.videoId,
          views: stats.viewCount,
          likes: stats.likeCount,
        });
      } else {
        nullStatsCount++;
        details.push({ id: market.id.slice(0, 8), videoId: market.videoId, views: null, likes: null });
      }

      // Refresh videoMetadata CDN-signed URLs (thumbnail and playUrl both expire ~24h).
      // Both are validated against domain allowlists before DB write.
      // Dirty-check skips the UPDATE when neither value has changed from what's stored.
      if (stats !== null) {
        const newThumbnail =
          stats.thumbnailUrl && TIKTOK_THUMBNAIL_RE.test(stats.thumbnailUrl)
            ? stats.thumbnailUrl
            : undefined;
        const newPlayUrl =
          stats.playUrl && TIKTOK_PLAY_URL_RE.test(stats.playUrl)
            ? stats.playUrl
            : undefined;

        const thumbnailChanged =
          newThumbnail !== undefined && newThumbnail !== market.videoMetadata?.thumbnail;
        const playUrlChanged =
          newPlayUrl !== undefined && newPlayUrl !== market.videoMetadata?.playUrl;

        if (thumbnailChanged || playUrlChanged) {
          await db
            .update(markets)
            .set({
              videoMetadata: {
                // Type-satisfaction fallback — markets always have videoMetadata set before polling begins
                ...(market.videoMetadata ?? { title: "", thumbnail: "", channelTitle: "" }),
                ...(thumbnailChanged && { thumbnail: newThumbnail! }),
                ...(playUrlChanged && { playUrl: newPlayUrl! }),
              },
            })
            .where(eq(markets.id, market.id));
        }
      }

      // Auto-resolve if milestone crossed
      if (stats !== null) {
        const metric =
          market.questionType === "views"
            ? BigInt(stats.viewCount)
            : BigInt(stats.likeCount);

        if (metric >= market.milestoneThreshold) {
          try {
            // Halt trading first (active → halted) to close the trade window before resolving.
            // No-op if the market is already halted.
            await db
              .update(markets)
              .set({ status: "halted" })
              .where(and(eq(markets.id, market.id), eq(markets.status, "active")));

            // Transition to resolving. Only proceeds if market is halted (i.e., we just halted
            // it above, or it was already halted). Guards against double-resolution.
            const transitioned = await db
              .update(markets)
              .set({ status: "resolving" })
              .where(and(eq(markets.id, market.id), eq(markets.status, "halted")))
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
      // Continue to next market — don't abort the whole poll on one failure
    }
  }

  return {
    polled: polledCount,
    ...(nullStatsCount > 0 && { nullStats: nullStatsCount }),
    skipped: activeMarkets.length - marketsToPoll.length,
    ...(earlyResolvedCount > 0 && { earlyResolved: earlyResolvedCount }),
    ...(errors.length > 0 && { errors }),
    ...(resolveErrors.length > 0 && { resolveErrors }),
    details,
  };
}
