import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyCronAuth } from "@/lib/cron-auth";
import { refundPositions } from "@/lib/services/payout";

/**
 * DELETE /api/admin/markets/[id]/cancel
 *
 * Cancels a market and refunds all positions.
 * Bearer-token authenticated — agent-accessible.
 *
 * Cannot cancel resolved, resolving, failed, or already cancelled markets.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 *
 * Response 200: { success: true, marketId }
 * Response 404: market not found
 * Response 422: market cannot be cancelled in its current status
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const { id } = await params;

  const result = await db.transaction(async (tx) => {
    const [market] = await tx
      .select({ id: markets.id, status: markets.status })
      .from(markets)
      .where(eq(markets.id, id))
      .limit(1);

    if (!market) return { error: "Market not found", status: 404 } as const;

    const nonCancellable = ["resolved", "cancelled", "resolving", "failed"];
    if (nonCancellable.includes(market.status)) {
      return {
        error: `Cannot cancel a market with status: ${market.status}`,
        status: 422,
      } as const;
    }

    await refundPositions(tx, id);
    await tx.update(markets).set({ status: "cancelled" }).where(eq(markets.id, id));

    return { success: true } as const;
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true, marketId: id });
}
