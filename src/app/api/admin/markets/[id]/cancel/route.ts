import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { verifyCronAuth } from "@/lib/cron-auth";
import { applyAdminRateLimit } from "@/lib/rate-limit";
import { refundPositions } from "@/lib/services/payout";

/**
 * DELETE /api/admin/markets/[id]/cancel
 *
 * Cancels a market and refunds all positions.
 * Bearer-token authenticated — agent-accessible.
 *
 * Cannot cancel resolved, resolving, failed, or already cancelled markets.
 *
 * V1 (Slice C): the status transition is a CAS (UPDATE ... WHERE status IN (...)
 * RETURNING id) so two concurrent cancel calls produce exactly one refund set —
 * the loser gets a clean 422 instead of a raw 23505 unique-constraint 5xx from
 * a duplicate coin_transactions insert in refundPositions.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 *
 * Response 200: { success: true, marketId }
 * Response 404: market not found
 * Response 422: market cannot be cancelled in its current status
 */
const CANCELLABLE_STATUSES = ["draft", "active", "halted"] as const;

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const rateLimited = applyAdminRateLimit(request, { limit: 10, windowMs: 60_000 });
  if (rateLimited) return rateLimited;

  const { id } = await params;

  const result = await db.transaction(async (tx) => {
    // 404 vs 422 discrimination: upfront SELECT distinguishes "no row at all"
    // (404) from "row exists but wrong status" (422 via the CAS below).
    const [market] = await tx
      .select({ id: markets.id, status: markets.status })
      .from(markets)
      .where(eq(markets.id, id))
      .limit(1);

    if (!market) return { error: "Market not found", status: 404 } as const;

    // CAS: atomic status transition, only if currently cancellable. The RETURNING
    // clause is the authoritative guard — the SELECT above is advisory (status
    // may have changed between the two statements under concurrent load).
    const updated = await tx
      .update(markets)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(markets.id, id),
          inArray(markets.status, CANCELLABLE_STATUSES as unknown as string[])
        )
      )
      .returning({ id: markets.id });

    if (updated.length === 0) {
      // Status changed between our SELECT and UPDATE — either a concurrent cancel
      // won the race, or the status was never cancellable.
      return {
        error: `Cannot cancel a market with status: ${market.status}`,
        status: 422,
      } as const;
    }

    // CAS won — refund. Only the winner reaches this code path.
    await refundPositions(tx, id);

    return { success: true } as const;
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true, marketId: id });
}
