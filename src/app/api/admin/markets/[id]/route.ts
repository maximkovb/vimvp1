import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyCronAuth } from "@/lib/cron-auth";
import { refundPositions } from "@/lib/services/payout";

// DELETE /api/admin/markets/[id] — cancel a market and refund all positions (bearer token required)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const { id } = await params;

  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, id))
    .limit(1);

  if (!market) {
    return NextResponse.json({ error: "Market not found" }, { status: 404 });
  }

  if (market.status === "resolved" || market.status === "cancelled") {
    return NextResponse.json(
      { error: `Cannot cancel a market with status "${market.status}"` },
      { status: 409 }
    );
  }

  await db.transaction(async (tx) => {
    await refundPositions(tx, id);
    await tx
      .update(markets)
      .set({ status: "cancelled" })
      .where(eq(markets.id, id));
  });

  return NextResponse.json({ marketId: id, status: "cancelled" });
}
