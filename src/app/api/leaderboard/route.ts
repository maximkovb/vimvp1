import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, positions, markets } from "@/db/schema";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getMarketPrices } from "@/lib/market-utils";

const TOP_N = 100;

// GET /api/leaderboard — returns top 100 users ranked by total portfolio value
export async function GET() {
  const topUsers = await db
    .select({
      id: users.id,
      name: users.name,
      balance: users.balance,
      loginStreak: users.loginStreak,
    })
    .from(users)
    .orderBy(desc(users.balance))
    .limit(TOP_N);

  const topUserIds = topUsers.map((u) => u.id);

  const allPositions =
    topUserIds.length > 0
      ? await db
          .select({
            userId: positions.userId,
            shares: positions.shares,
            outcome: positions.outcome,
            quantityYes: markets.quantityYes,
            quantityNo: markets.quantityNo,
            bParameter: markets.bParameter,
            marketStatus: markets.status,
          })
          .from(positions)
          .innerJoin(markets, eq(positions.marketId, markets.id))
          .where(
            and(ne(positions.shares, "0"), inArray(positions.userId, topUserIds))
          )
      : [];

  const positionsByUser = new Map<string, typeof allPositions>();
  for (const pos of allPositions) {
    const arr = positionsByUser.get(pos.userId) ?? [];
    arr.push(pos);
    positionsByUser.set(pos.userId, arr);
  }

  const ranked = topUsers
    .map((user) => {
      const userPositions = positionsByUser.get(user.id) ?? [];
      let positionsValue = 0;
      for (const pos of userPositions) {
        if (pos.marketStatus === "resolved") continue;
        const prices = getMarketPrices(pos);
        positionsValue += parseFloat(pos.shares) * prices[pos.outcome];
      }
      const balance = parseFloat(user.balance);
      const totalValue = balance + positionsValue;
      return {
        id: user.id,
        name: user.name ?? "Anonymous",
        balance,
        positionsValue,
        totalValue,
        loginStreak: user.loginStreak,
      };
    })
    .sort((a, b) => b.totalValue - a.totalValue);

  return NextResponse.json({ traders: ranked });
}
