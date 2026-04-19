import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyCronAuth } from "@/lib/cron-auth";

/**
 * PATCH /api/admin/markets/[id]/publish
 *
 * Promotes a draft market to active.
 * Bearer-token authenticated — agent-accessible.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 *
 * Response 200: { success: true, marketId }
 * Response 404: market not found
 * Response 422: market is not in draft status
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const { id } = await params;

  const [market] = await db
    .select({ id: markets.id, status: markets.status, resolvesAt: markets.resolvesAt })
    .from(markets)
    .where(eq(markets.id, id))
    .limit(1);

  if (!market) {
    return NextResponse.json({ error: "Market not found" }, { status: 404 });
  }
  if (market.status !== "draft") {
    return NextResponse.json(
      { error: `Only draft markets can be published (current status: ${market.status})` },
      { status: 422 }
    );
  }

  const now = new Date();
  const resolvesAt = market.resolvesAt ?? new Date(now.getTime() + 72 * 60 * 60 * 1000);
  const haltsAt = new Date(resolvesAt.getTime() - 5 * 60 * 1000);

  await db
    .update(markets)
    .set({ status: "active", opensAt: now, haltsAt, resolvesAt })
    .where(eq(markets.id, id));

  return NextResponse.json({ success: true, marketId: id });
}
