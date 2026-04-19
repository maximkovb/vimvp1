import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { resolveMarket } from "@/lib/oracle";
import { verifyCronAuth } from "@/lib/cron-auth";

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const now = new Date();
  const results: {
    halted: string[];
    resolved: string[];
    failed: string[];
  } = { halted: [], resolved: [], failed: [] };

  // 1. Bulk transition ACTIVE → HALTED (5 min before resolution)
  const haltedRows = await db
    .update(markets)
    .set({ status: "halted" })
    .where(and(eq(markets.status, "active"), sql`${markets.haltsAt} <= ${now}`))
    .returning({ id: markets.id });
  results.halted = haltedRows.map((r) => r.id);

  // 2. Bulk transition HALTED → RESOLVING (at resolution time)
  await db
    .update(markets)
    .set({ status: "resolving" })
    .where(and(eq(markets.status, "halted"), sql`${markets.resolvesAt} <= ${now}`));

  // Safety net: active markets past resolvesAt that missed the halt window.
  // Two-step halt→resolving to close the trading window before resolution begins.
  // A direct active→resolving would leave a gap where trades pass the status='active' guard.
  await db
    .update(markets)
    .set({ status: "halted" })
    .where(and(eq(markets.status, "active"), sql`${markets.resolvesAt} <= ${now}`));
  await db
    .update(markets)
    .set({ status: "resolving" })
    .where(and(eq(markets.status, "halted"), sql`${markets.resolvesAt} <= ${now}`));

  // 3. Resolve RESOLVING markets via oracle
  const resolvingMarkets = await db
    .select()
    .from(markets)
    .where(eq(markets.status, "resolving"));

  for (const market of resolvingMarkets) {
    try {
      await resolveMarket(market.id);
      results.resolved.push(market.id);
    } catch (error) {
      console.error(`Failed to resolve market ${market.id}:`, error);
      // Guard: don't overwrite status=resolved if a concurrent worker already succeeded.
      // The thrown error could be the unique-constraint rollback from the concurrent worker's
      // coin_transactions insert — in that case the market is already correctly resolved.
      await db
        .update(markets)
        .set({ status: "failed" })
        .where(and(eq(markets.id, market.id), eq(markets.status, "resolving")));
      results.failed.push(market.id);
    }
  }

  return NextResponse.json(results);
}
