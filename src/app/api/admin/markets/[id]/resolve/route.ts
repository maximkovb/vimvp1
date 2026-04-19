import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { eq, and, or } from "drizzle-orm";
import { z } from "zod";
import { verifyCronAuth } from "@/lib/cron-auth";
import { distributePayout } from "@/lib/services/payout";

const ResolveSchema = z.object({
  outcome: z.union([z.literal(0), z.literal(1)]),
});

/**
 * POST /api/admin/markets/[id]/resolve
 *
 * Manually resolves a failed or resolving market.
 * Bearer-token authenticated — agent-accessible.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 * Body: { outcome: 0 | 1 }  (0 = YES, 1 = NO)
 *
 * Response 200: { success: true, marketId }
 * Response 400: invalid body
 * Response 404: market not found
 * Response 422: market is not in failed or resolving status
 */
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

  const result = await db.transaction(async (tx) => {
    const [market] = await tx
      .select({ id: markets.id, status: markets.status })
      .from(markets)
      .where(eq(markets.id, id))
      .limit(1);

    if (!market) return { error: "Market not found", status: 404 } as const;

    if (market.status !== "failed" && market.status !== "resolving") {
      return {
        error: `Can only manually resolve failed or resolving markets (current status: ${market.status})`,
        status: 422,
      } as const;
    }

    // Guard on status prevents overwriting an already-resolved market and paying
    // a second outcome — which would credit both YES and NO holders for the same market.
    const updated = await tx
      .update(markets)
      .set({ status: "resolved", outcome, resolvedAt: new Date() })
      .where(and(eq(markets.id, id), or(eq(markets.status, "failed"), eq(markets.status, "resolving"))))
      .returning({ id: markets.id });

    if (updated.length === 0) {
      return { error: `Market is no longer in failed or resolving status`, status: 422 } as const;
    }

    await distributePayout(tx, id, outcome);

    return { success: true } as const;
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true, marketId: id });
}
