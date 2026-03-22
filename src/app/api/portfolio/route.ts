import { NextResponse } from "next/server";
import { db } from "@/db";
import { positions, markets, trades, users } from "@/db/schema";
import { eq, and, desc, ne } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { price } from "@/lib/lmsr";

// GET /api/portfolio — returns authenticated user's balance and positions
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const [user] = await db
    .select({ balance: users.balance, loginStreak: users.loginStreak })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const [openPositions, recentTrades] = await Promise.all([
    db
      .select({ position: positions, market: markets })
      .from(positions)
      .innerJoin(markets, eq(positions.marketId, markets.id))
      .where(and(eq(positions.userId, userId), ne(positions.shares, "0"))),
    db
      .select({
        id: trades.id,
        marketId: trades.marketId,
        marketTitle: markets.title,
        outcome: trades.outcome,
        shares: trades.shares,
        cost: trades.cost,
        priceBefore: trades.priceBefore,
        priceAfter: trades.priceAfter,
        createdAt: trades.createdAt,
      })
      .from(trades)
      .innerJoin(markets, eq(trades.marketId, markets.id))
      .where(eq(trades.userId, userId))
      .orderBy(desc(trades.createdAt))
      .limit(20),
  ]);

  const balance = parseFloat(user.balance);
  let openValue = 0;

  const positionsOut = openPositions.map(({ position, market }) => {
    const quantities = [
      parseFloat(market.quantityYes),
      parseFloat(market.quantityNo),
    ];
    const b = parseFloat(market.bParameter);
    const shares = parseFloat(position.shares);
    const currentPrice = price(quantities, b, position.outcome);
    const markToMarket = shares * currentPrice;

    if (
      market.status === "active" ||
      market.status === "halted" ||
      market.status === "resolving"
    ) {
      openValue += markToMarket;
    }

    return {
      positionId: position.id,
      marketId: market.id,
      marketTitle: market.title,
      marketStatus: market.status,
      outcome: position.outcome,
      shares,
      avgCostBasis: parseFloat(position.avgCostBasis),
      currentPrice,
      markToMarket,
      pnl: markToMarket - parseFloat(position.avgCostBasis) * shares,
    };
  });

  return NextResponse.json({
    balance,
    openValue,
    totalValue: balance + openValue,
    loginStreak: user.loginStreak,
    positions: positionsOut,
    recentTrades: recentTrades.map((t) => ({
      ...t,
      shares: parseFloat(t.shares),
      cost: parseFloat(t.cost),
      priceBefore: parseFloat(t.priceBefore),
      priceAfter: parseFloat(t.priceAfter),
    })),
  });
}
