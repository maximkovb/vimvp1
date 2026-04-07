import { db } from "@/db";
import { positions, markets, trades, users } from "@/db/schema";
import { eq, and, desc, ne } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { price } from "@/lib/lmsr";
import Link from "next/link";
import { SellButton } from "@/components/SellButton";
import { DailyReward } from "@/components/DailyReward";
import { formatOutcome } from "@/lib/format";

export default async function PortfolioPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const userId = session.user.id;

  // Fetch user balance and streak info
  const [user] = await db
    .select({
      balance: users.balance,
      loginStreak: users.loginStreak,
      lastLoginReward: users.lastLoginReward,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // Check if daily reward already claimed today (UTC to match claimDailyReward in economy.ts)
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const alreadyClaimed = user?.lastLoginReward
    ? new Date(Date.UTC(
        user.lastLoginReward.getUTCFullYear(),
        user.lastLoginReward.getUTCMonth(),
        user.lastLoginReward.getUTCDate()
      )).getTime() === todayUTC.getTime()
    : false;

  // Fetch open positions with market data
  const openPositions = await db
    .select({
      position: positions,
      market: markets,
    })
    .from(positions)
    .innerJoin(markets, eq(positions.marketId, markets.id))
    .where(
      and(
        eq(positions.userId, userId),
        ne(positions.shares, "0")
      )
    );

  // Separate into active and resolved
  const activePositions = openPositions.filter(
    (p) =>
      p.market.status === "active" ||
      p.market.status === "halted" ||
      p.market.status === "resolving"
  );

  const resolvedPositions = openPositions.filter(
    (p) => p.market.status === "resolved"
  );

  // Calculate portfolio values
  let openValue = 0;
  const positionsWithValue = activePositions.map((p) => {
    const quantities = [
      parseFloat(p.market.quantityYes),
      parseFloat(p.market.quantityNo),
    ];
    const b = parseFloat(p.market.bParameter);
    const shares = parseFloat(p.position.shares);
    const currentPrice = price(quantities, b, p.position.outcome);
    const markToMarket = shares * currentPrice;
    openValue += markToMarket;

    return {
      ...p,
      currentPrice,
      markToMarket,
      costBasis: parseFloat(p.position.avgCostBasis) * shares,
      pnl: markToMarket - parseFloat(p.position.avgCostBasis) * shares,
    };
  });

  // Recent trades (preview only — full history at /history)
  const recentTrades = await db
    .select({
      trade: trades,
      market: { title: markets.title, id: markets.id },
    })
    .from(trades)
    .innerJoin(markets, eq(trades.marketId, markets.id))
    .where(eq(trades.userId, userId))
    .orderBy(desc(trades.createdAt))
    .limit(5);

  const balance = parseFloat(user?.balance || "0");
  const totalValue = balance + openValue;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-6">Portfolio</h1>

      {/* Daily reward */}
      <div className="mb-6">
        <DailyReward
          alreadyClaimed={alreadyClaimed}
          currentStreak={user?.loginStreak ?? 0}
        />
      </div>

      {/* Balance summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-sm text-muted">Cash Balance</div>
          <div className="text-2xl font-bold">{balance.toFixed(0)}</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-sm text-muted">Open Positions</div>
          <div className="text-2xl font-bold">{openValue.toFixed(0)}</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-sm text-muted">Total Value</div>
          <div className="text-2xl font-bold text-accent">
            {totalValue.toFixed(0)}
          </div>
        </div>
      </div>

      {/* Active positions */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Active Positions</h2>
        {positionsWithValue.length > 0 ? (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="text-left p-3 font-medium">Market</th>
                    <th className="text-center p-3 font-medium">Side</th>
                    <th className="text-right p-3 font-medium">Shares</th>
                    <th className="text-right p-3 font-medium">Price</th>
                    <th className="text-right p-3 font-medium">Value</th>
                    <th className="text-right p-3 font-medium">P/L</th>
                    <th className="text-right p-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {positionsWithValue.map((p) => (
                    <tr
                      key={p.position.id}
                      className="border-b border-border last:border-0 hover:bg-card-hover"
                    >
                      <td className="p-3">
                        <Link
                          href={`/markets/${p.market.id}`}
                          className="text-accent hover:underline"
                        >
                          {p.market.title}
                        </Link>
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            p.position.outcome === 0
                              ? "bg-green/10 text-green"
                              : "bg-red/10 text-red"
                          }`}
                        >
                          {formatOutcome(p.position.outcome)}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {parseFloat(p.position.shares).toFixed(1)}
                      </td>
                      <td className="p-3 text-right">
                        {(p.currentPrice * 100).toFixed(1)}%
                      </td>
                      <td className="p-3 text-right">
                        {p.markToMarket.toFixed(1)}
                      </td>
                      <td
                        className={`p-3 text-right font-medium ${
                          p.pnl >= 0 ? "text-green" : "text-red"
                        }`}
                      >
                        {p.pnl >= 0 ? "+" : ""}
                        {p.pnl.toFixed(1)}
                      </td>
                      <td className="p-3 text-right">
                        {p.market.status === "active" && (
                          <SellButton
                            marketId={p.market.id}
                            outcome={p.position.outcome}
                            maxShares={parseFloat(p.position.shares)}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl p-6 text-center text-muted text-sm">
            No active positions.{" "}
            <Link href="/" className="text-accent hover:underline">
              Browse markets
            </Link>{" "}
            to start trading.
          </div>
        )}
      </section>

      {/* Resolved positions */}
      {resolvedPositions.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Resolved</h2>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="text-left p-3 font-medium">Market</th>
                    <th className="text-center p-3 font-medium">Your Bet</th>
                    <th className="text-center p-3 font-medium">Result</th>
                    <th className="text-right p-3 font-medium">Shares</th>
                    <th className="text-right p-3 font-medium">Cost</th>
                    <th className="text-right p-3 font-medium">Payout</th>
                    <th className="text-right p-3 font-medium">Net P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {resolvedPositions.map((p) => {
                    const won = p.position.outcome === p.market.outcome;
                    const shares = parseFloat(p.position.shares);
                    const payout = won ? shares : 0;
                    const cost = parseFloat(p.position.avgCostBasis) * shares;
                    const netPnl = payout - cost;
                    return (
                      <tr
                        key={p.position.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="p-3">
                          <Link
                            href={`/markets/${p.market.id}`}
                            className="text-accent hover:underline"
                          >
                            {p.market.title}
                          </Link>
                        </td>
                        <td className="p-3 text-center">
                          {formatOutcome(p.position.outcome)}
                        </td>
                        <td className="p-3 text-center">
                          <span
                            className={`font-medium ${
                              won ? "text-green" : "text-red"
                            }`}
                          >
                            {won ? "Won" : "Lost"}
                          </span>
                        </td>
                        <td className="p-3 text-right">{shares.toFixed(1)}</td>
                        <td className="p-3 text-right text-muted">
                          {cost.toFixed(1)}
                        </td>
                        <td
                          className={`p-3 text-right font-medium ${
                            won ? "text-green" : "text-muted"
                          }`}
                        >
                          {payout.toFixed(1)}
                        </td>
                        <td
                          className={`p-3 text-right font-medium ${
                            netPnl >= 0 ? "text-green" : "text-red"
                          }`}
                        >
                          {netPnl >= 0 ? "+" : ""}
                          {netPnl.toFixed(1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Recent trades */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Recent Trades</h2>
          <Link href="/history" className="text-sm text-accent hover:underline">
            View all →
          </Link>
        </div>
        {recentTrades.length > 0 ? (
          <div className="bg-card border border-border rounded-xl p-4 space-y-2">
            {recentTrades.map((t) => (
              <div
                key={t.trade.id}
                className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                      parseFloat(t.trade.shares) > 0
                        ? "bg-green/10 text-green"
                        : "bg-red/10 text-red"
                    }`}
                  >
                    {parseFloat(t.trade.shares) > 0 ? "BUY" : "SELL"}
                  </span>
                  <span className="font-medium">
                    {t.trade.outcome === 1 ? "YES" : "NO"}
                  </span>
                  <Link
                    href={`/markets/${t.market.id}`}
                    className="text-muted hover:text-accent truncate max-w-[200px]"
                  >
                    {t.market.title}
                  </Link>
                </div>
                <div className="text-right text-muted whitespace-nowrap">
                  <span className="font-medium text-foreground">
                    {Math.abs(parseFloat(t.trade.cost)).toFixed(1)}
                  </span>{" "}
                  coins
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl p-6 text-center text-muted text-sm">
            No trades yet.
          </div>
        )}
      </section>
    </div>
  );
}
