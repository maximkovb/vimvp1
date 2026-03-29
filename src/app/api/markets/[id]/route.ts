import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets, priceSnapshots, trades, youtubePolls } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { allPrices } from "@/lib/lmsr";

// GET /api/markets/[id] — returns single market state with price history
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, id))
    .limit(1);

  if (!market) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const quantities = [
    parseFloat(market.quantityYes),
    parseFloat(market.quantityNo),
  ];
  const b = parseFloat(market.bParameter);
  const [priceYes, priceNo] = allPrices(quantities, b);

  const [history, recentTrades, polls] = await Promise.all([
    db
      .select({
        time: priceSnapshots.recordedAt,
        priceYes: priceSnapshots.priceYes,
        priceNo: priceSnapshots.priceNo,
        volumeTotal: priceSnapshots.volumeTotal,
      })
      .from(priceSnapshots)
      .where(eq(priceSnapshots.marketId, id))
      .orderBy(priceSnapshots.recordedAt)
      .limit(500),
    db
      .select()
      .from(trades)
      .where(eq(trades.marketId, id))
      .orderBy(desc(trades.createdAt))
      .limit(20),
    db
      .select({
        polledAt: youtubePolls.polledAt,
        viewCount: youtubePolls.viewCount,
        likeCount: youtubePolls.likeCount,
      })
      .from(youtubePolls)
      .where(eq(youtubePolls.marketId, id))
      .orderBy(youtubePolls.polledAt)
      .limit(500),
  ]);

  return NextResponse.json({
    id: market.id,
    title: market.title,
    description: market.description,
    status: market.status,
    questionType: market.questionType,
    milestoneThreshold: market.milestoneThreshold.toString(),
    youtubeVideoId: market.youtubeVideoId,
    videoMetadata: market.videoMetadata,
    priceYes,
    priceNo,
    outcome: market.outcome,
    resolvesAt: market.resolvesAt,
    resolvedAt: market.resolvedAt,
    priceHistory: history.map((h) => ({
      time: h.time,
      priceYes: parseFloat(h.priceYes),
      priceNo: parseFloat(h.priceNo),
      volumeTotal: parseFloat(h.volumeTotal),
    })),
    recentTrades: recentTrades.map((t) => ({
      id: t.id,
      outcome: t.outcome,
      shares: parseFloat(t.shares),
      cost: parseFloat(t.cost),
      priceBefore: parseFloat(t.priceBefore),
      priceAfter: parseFloat(t.priceAfter),
      createdAt: t.createdAt,
    })),
    pollHistory: polls.map((p) => ({
      time: p.polledAt.toISOString(),
      viewCount: p.viewCount !== null ? Number(p.viewCount) : null,
      likeCount: p.likeCount !== null ? Number(p.likeCount) : null,
    })),
  });
}
