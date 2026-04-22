import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { and, eq, notInArray } from "drizzle-orm";
import { verifyCronAuth } from "@/lib/cron-auth";
import { applyAdminRateLimit } from "@/lib/rate-limit";
import { requireAdminLifecycleEnabled } from "@/lib/admin-lifecycle-gate";
import { resolveMarket } from "@/lib/oracle";

/**
 * POST /api/admin/markets/[id]/resolve-now
 *
 * Force-resolves a market using the oracle (latest-ever-crossed-threshold
 * rule). Bearer-token authenticated — agent-accessible. Gated by
 * ADMIN_BEARER_LIFECYCLE_ENABLED in production until Slice B P0 is fixed.
 *
 * Semantics:
 *   1. CAS the prior status → 'resolving'. The `WHERE status NOT IN
 *      ('resolved','cancelled','resolving') RETURNING id` is the authoritative
 *      guard — concurrent cron-poll or admin-click beat us → 0 rows → 422.
 *   2. Call resolveMarket(id) — it opens its own transaction for the final
 *      UPDATE + payout.
 *   3. On resolveMarket throw: compensating CAS restores the prior status
 *      (only if the row is still 'resolving' — don't stomp if a concurrent
 *      writer moved on). The caller sees 5xx + the oracle's error message.
 *
 * No outer transaction wraps the CAS + oracle call. Wrapping would force
 * nested-transaction savepoint semantics; the compensating-CAS approach is
 * portable and sufficient because resolveMarket's own internal transaction
 * rolls back on throw, leaving state consistent for compensation.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 *
 * Response 200: { success: true, marketId }
 * Response 401: missing or invalid bearer
 * Response 404: market not found
 * Response 422: market is in a terminal status, already resolving, or lost the CAS race
 * Response 500: oracle failed (e.g., no poll data) — market status restored to prior
 * Response 503: feature gated off
 */
const NON_TRANSITIONABLE = ["resolved", "cancelled", "resolving"] as const;

export async function POST(
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

  // Existence check — distinguish 404 from 422.
  const [market] = await db
    .select({ id: markets.id, status: markets.status })
    .from(markets)
    .where(eq(markets.id, id))
    .limit(1);

  if (!market) {
    return NextResponse.json({ error: "Market not found" }, { status: 404 });
  }

  const previousStatus = market.status;

  // Fast-reject terminal / already-resolving states (advisory; CAS below is authoritative).
  if ((NON_TRANSITIONABLE as readonly string[]).includes(previousStatus)) {
    return NextResponse.json(
      {
        error: `Cannot resolve-now a market with status: ${previousStatus}`,
      },
      { status: 422 },
    );
  }

  // Outer CAS: transition to 'resolving' only if status hasn't drifted.
  const transitioned = await db
    .update(markets)
    .set({ status: "resolving" })
    .where(
      and(
        eq(markets.id, id),
        notInArray(markets.status, NON_TRANSITIONABLE as unknown as string[]),
      ),
    )
    .returning({ id: markets.id });

  if (transitioned.length === 0) {
    // Concurrent writer (cron-poll or another admin click) won the race.
    return NextResponse.json(
      {
        error:
          "Market status changed while we were transitioning — no longer eligible for resolve-now",
      },
      { status: 422 },
    );
  }

  // Outer CAS won — call the oracle. On any throw, compensate by restoring prior
  // status (guarded on status='resolving' so we don't stomp concurrent progress).
  try {
    await resolveMarket(id);
  } catch (err) {
    await db
      .update(markets)
      .set({ status: previousStatus })
      .where(and(eq(markets.id, id), eq(markets.status, "resolving")))
      .returning({ id: markets.id });

    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ success: true, marketId: id });
}
