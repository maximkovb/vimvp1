import { db } from "@/db";
import { users, positions, markets } from "@/db/schema";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getMarketPrices } from "@/lib/market-utils";

const TOP_N = 100;

export default async function LeaderboardPage() {
  // Two queries instead of N+1: top users + their non-zero positions
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

  const allPositions = topUserIds.length > 0
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
        .where(and(ne(positions.shares, "0"), inArray(positions.userId, topUserIds)))
    : [];

  // Group positions by userId
  const positionsByUser = new Map<string, typeof allPositions>();
  for (const pos of allPositions) {
    const arr = positionsByUser.get(pos.userId) ?? [];
    arr.push(pos);
    positionsByUser.set(pos.userId, arr);
  }

  // Calculate portfolio values
  const ranked = topUsers.map((user) => {
    const userPositions = positionsByUser.get(user.id) ?? [];
    let positionsValue = 0;
    for (const pos of userPositions) {
      if (pos.marketStatus === "resolved") continue;
      const prices = getMarketPrices(pos);
      const shares = parseFloat(pos.shares);
      positionsValue += shares * prices[pos.outcome];
    }

    const totalValue = parseFloat(user.balance) + positionsValue;
    return { ...user, positionsValue, totalValue };
  });

  ranked.sort((a, b) => b.totalValue - a.totalValue);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-6">Leaderboard</h1>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="text-left p-3 font-medium w-12">#</th>
              <th className="text-left p-3 font-medium">Trader</th>
              <th className="text-right p-3 font-medium">Balance</th>
              <th className="text-right p-3 font-medium">Positions</th>
              <th className="text-right p-3 font-medium">Total Value</th>
              <th className="text-right p-3 font-medium">Streak</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((user, i) => (
              <tr
                key={user.id}
                className="border-b border-border last:border-0 hover:bg-card-hover"
              >
                <td className="p-3 font-bold text-muted">
                  {i === 0 ? "1st" : i === 1 ? "2nd" : i === 2 ? "3rd" : `${i + 1}th`}
                </td>
                <td className="p-3 font-medium">
                  {user.name || "Anonymous"}
                </td>
                <td className="p-3 text-right">
                  {parseFloat(user.balance).toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </td>
                <td className="p-3 text-right text-muted">
                  {user.positionsValue > 0
                    ? user.positionsValue.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })
                    : "—"}
                </td>
                <td className="p-3 text-right font-bold">
                  {user.totalValue.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </td>
                <td className="p-3 text-right">
                  {user.loginStreak > 0 ? `${user.loginStreak}d` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
