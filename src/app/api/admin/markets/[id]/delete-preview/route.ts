import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  markets,
  trades,
  positions,
  priceSnapshots,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { verifyCronAuth } from "@/lib/cron-auth";
import { requireAdminLifecycleEnabled } from "@/lib/admin-lifecycle-gate";

/**
 * GET /api/admin/markets/[id]/delete-preview
 *
 * Read-only pre-check for clipmarket's Delete UI. Tells the caller which
 * branch `DELETE /api/admin/markets/[id]` will take, so the UI can pick the
 * right confirm() copy (or skip confirm entirely for terminal-reject).
 *
 * Returns the branch name + current status ONLY. Raw counts (trades,
 * positions, snapshots) are intentionally NOT returned — resolves the
 * security finding that a CRON_SECRET holder could otherwise enumerate
 * market activity via polled preview calls.
 *
 * No locks, no writes. Eventually consistent with the subsequent DELETE —
 * if state changes between preview and DELETE, the DELETE's SELECT FOR
 * UPDATE is authoritative.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>. Gated by ADMIN_BEARER_LIFECYCLE_ENABLED.
 *
 * Response 200: { branch: 'hard-delete' | 'cancel-instead' | 'terminal-reject', status }
 * Response 401: missing/invalid bearer
 * Response 404: market not found
 * Response 503: feature gated off
 */
type PreviewBranch = "hard-delete" | "cancel-instead" | "terminal-reject";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const gateError = requireAdminLifecycleEnabled();
  if (gateError) return gateError;

  const { id } = await params;

  const [market] = await db
    .select({ id: markets.id, status: markets.status })
    .from(markets)
    .where(eq(markets.id, id))
    .limit(1);

  if (!market) {
    return NextResponse.json({ error: "Market not found" }, { status: 404 });
  }

  const status = market.status;

  if (status === "resolved" || status === "cancelled") {
    const branch: PreviewBranch = "terminal-reject";
    return NextResponse.json({ branch, status });
  }

  // hard-delete only when status='draft' AND every related table is empty.
  // Short-circuit: if status isn't draft, skip the counts entirely.
  if (status !== "draft") {
    const branch: PreviewBranch = "cancel-instead";
    return NextResponse.json({ branch, status });
  }

  const clean = await countsAllZero(id);
  const branch: PreviewBranch = clean ? "hard-delete" : "cancel-instead";
  return NextResponse.json({ branch, status });
}

async function countsAllZero(marketId: string): Promise<boolean> {
  const tables = [
    { rel: trades, col: trades.marketId },
    { rel: positions, col: positions.marketId },
    { rel: priceSnapshots, col: priceSnapshots.marketId },
  ] as const;

  for (const { rel, col } of tables) {
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(rel)
      .where(eq(col, marketId));

    if (Number(row?.count ?? 0) > 0) return false;
  }
  return true;
}
