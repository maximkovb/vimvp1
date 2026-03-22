import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { desc, eq, or } from "drizzle-orm";
import { getMarketPrices } from "@/lib/market-utils";

// GET /api/markets — returns active/halted/resolving markets + last 6 resolved
export async function GET() {
  const [activeMarkets, resolvedMarkets] = await Promise.all([
    db
      .select()
      .from(markets)
      .where(
        or(
          eq(markets.status, "active"),
          eq(markets.status, "halted"),
          eq(markets.status, "resolving")
        )
      )
      .orderBy(desc(markets.createdAt))
      .limit(50),
    db
      .select()
      .from(markets)
      .where(eq(markets.status, "resolved"))
      .orderBy(desc(markets.resolvedAt))
      .limit(6),
  ]);

  const serialize = (market: (typeof markets.$inferSelect)[]) =>
    market.map((m) => {
      const [priceYes, priceNo] = getMarketPrices(m);
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        status: m.status,
        questionType: m.questionType,
        milestoneThreshold: m.milestoneThreshold.toString(),
        priceYes,
        priceNo,
        outcome: m.outcome,
        resolvesAt: m.resolvesAt,
        resolvedAt: m.resolvedAt,
        videoMetadata: m.videoMetadata,
      };
    });

  return NextResponse.json({
    active: serialize(activeMarkets),
    resolved: serialize(resolvedMarkets),
  });
}
