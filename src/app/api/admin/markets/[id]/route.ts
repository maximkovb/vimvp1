import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  markets,
  trades,
  positions,
  priceSnapshots,
} from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { verifyCronAuth } from "@/lib/cron-auth";
import { applyAdminRateLimit } from "@/lib/rate-limit";
import { requireAdminLifecycleEnabled } from "@/lib/admin-lifecycle-gate";
import { refundPositions } from "@/lib/services/payout";

/**
 * DELETE /api/admin/markets/[id]
 *
 * Dual-branch destructor:
 *   - Hard-delete branch: physically DELETEs the markets row when status='draft'
 *     AND trades/positions/priceSnapshots are all empty. Safe because no user
 *     money is involved. tiktok_polls.market_id cascades via FK.
 *   - Cancel-instead branch: any other status OR any market that has ever been
 *     traded. Runs the same CAS + refundPositions sequence as V1's
 *     cancel/route.ts (inlined — two-site duplication is intentional).
 *
 * The full sequence runs in one transaction with SELECT ... FOR UPDATE on
 * the markets row so a concurrent trade cannot land between the count check
 * and the DELETE. If a trade wins the race, the count sees >0 and this route
 * takes the cancel-instead branch.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>. Gated by ADMIN_BEARER_LIFECYCLE_ENABLED.
 *
 * Response 200: { success: true, marketId, deleted?: true, cancelled?: true }
 * Response 401: missing/invalid bearer
 * Response 404: market not found
 * Response 422: cancel-instead branch rejected by CAS (e.g., terminal status)
 * Response 503: feature gated off
 */
const CANCELLABLE_STATUSES = ["draft", "active", "halted"] as const;

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const rateLimited = applyAdminRateLimit(request, { limit: 10, windowMs: 60_000 });
  if (rateLimited) return rateLimited;

  const gateError = requireAdminLifecycleEnabled();
  if (gateError) return gateError;

  const { id } = await params;

  const result = await db.transaction(async (tx) => {
    // Row-lock the candidate — serializes against concurrent trade inserts
    // in the same transaction scope so count(*) + DELETE is atomic.
    const [market] = await tx
      .select({ id: markets.id, status: markets.status })
      .from(markets)
      .where(eq(markets.id, id))
      .limit(1)
      .for("update");

    if (!market) return { error: "Market not found", status: 404 } as const;

    const isClean =
      market.status === "draft" && (await countsAllZero(tx, id));

    if (isClean) {
      // Hard-delete: physical DELETE. tiktok_polls cascades via FK.
      await tx.delete(markets).where(eq(markets.id, id)).returning({ id: markets.id });
      return { deleted: true } as const;
    }

    // Cancel-instead branch — same CAS + refund sequence V1 uses inline.
    const updated = await tx
      .update(markets)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(markets.id, id),
          inArray(markets.status, CANCELLABLE_STATUSES as unknown as string[]),
        ),
      )
      .returning({ id: markets.id });

    if (updated.length === 0) {
      return {
        error: `Cannot cancel a market with status: ${market.status}`,
        status: 422,
      } as const;
    }

    await refundPositions(tx, id);
    return { cancelled: true } as const;
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if ("deleted" in result) {
    return NextResponse.json({ success: true, marketId: id, deleted: true });
  }

  return NextResponse.json({ success: true, marketId: id, cancelled: true });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function countsAllZero(tx: Tx, marketId: string): Promise<boolean> {
  const tables = [
    { rel: trades, col: trades.marketId },
    { rel: positions, col: positions.marketId },
    { rel: priceSnapshots, col: priceSnapshots.marketId },
  ] as const;

  for (const { rel, col } of tables) {
    const [row] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(rel)
      .where(eq(col, marketId));

    if (Number(row?.count ?? 0) > 0) return false;
  }
  return true;
}
