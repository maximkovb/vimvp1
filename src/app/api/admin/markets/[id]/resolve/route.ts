import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyCronAuth } from "@/lib/cron-auth";
import { distributePayout } from "@/lib/services/payout";
import { z } from "zod";

const ResolveSchema = z.object({
  outcome: z.union([z.literal(0), z.literal(1)]),
});

// POST /api/admin/markets/[id]/resolve — manually resolve a market (bearer token required)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ResolveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { outcome } = parsed.data;

  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, id))
    .limit(1);

  if (!market) {
    return NextResponse.json({ error: "Market not found" }, { status: 404 });
  }

  if (market.status !== "resolving" && market.status !== "failed") {
    return NextResponse.json(
      { error: `Can only manually resolve markets in "resolving" or "failed" status (current: "${market.status}")` },
      { status: 409 }
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(markets)
      .set({ status: "resolved", outcome, resolvedAt: new Date() })
      .where(eq(markets.id, id));

    await distributePayout(tx, id, outcome);
  });

  return NextResponse.json({ marketId: id, outcome, status: "resolved" });
}
