import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyCronAuth } from "@/lib/cron-auth";

// PATCH /api/admin/markets/[id]/publish — publish a draft market (bearer token required)
export async function PATCH(
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

  if (market.status !== "draft") {
    return NextResponse.json(
      { error: `Only draft markets can be published (current status: "${market.status}")` },
      { status: 409 }
    );
  }

  const now = new Date();
  // Default to 72h resolution window if no resolvesAt was set on the draft
  const resolvesAt = market.resolvesAt ?? new Date(now.getTime() + 72 * 60 * 60 * 1000);
  const haltsAt = new Date(resolvesAt.getTime() - 5 * 60 * 1000);

  try {
    await db
      .update(markets)
      .set({
        status: "active",
        opensAt: now,
        haltsAt,
        resolvesAt,
      })
      .where(eq(markets.id, id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `DB error: ${message}` }, { status: 500 });
  }

  return NextResponse.json({ marketId: id, status: "active" });
}
