import { db } from "@/db";
import { trades, markets } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { formatOutcome } from "@/lib/format";

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const userId = session.user.id;

  const allTrades = await db
    .select({
      trade: trades,
      market: { id: markets.id, title: markets.title },
    })
    .from(trades)
    .innerJoin(markets, eq(trades.marketId, markets.id))
    .where(eq(trades.userId, userId))
    .orderBy(desc(trades.createdAt))
    .limit(100);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Trade History</h1>
        <Link href="/portfolio" className="text-sm text-muted hover:text-foreground">
          ← Portfolio
        </Link>
      </div>

      {allTrades.length > 0 ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="text-left p-3 font-medium">Date</th>
                  <th className="text-left p-3 font-medium">Market</th>
                  <th className="text-center p-3 font-medium">Side</th>
                  <th className="text-center p-3 font-medium">Outcome</th>
                  <th className="text-right p-3 font-medium">Shares</th>
                  <th className="text-right p-3 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {allTrades.map((t) => {
                  const isBuy = parseFloat(t.trade.shares) > 0;
                  return (
                    <tr
                      key={t.trade.id}
                      className="border-b border-border last:border-0 hover:bg-card-hover"
                    >
                      <td className="p-3 text-muted whitespace-nowrap">
                        {new Date(t.trade.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td className="p-3 max-w-[260px]">
                        <Link
                          href={`/markets/${t.market.id}`}
                          className="text-accent hover:underline line-clamp-1 block"
                        >
                          {t.market.title}
                        </Link>
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            isBuy
                              ? "bg-green/10 text-green"
                              : "bg-red/10 text-red"
                          }`}
                        >
                          {isBuy ? "BUY" : "SELL"}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            t.trade.outcome === 0
                              ? "bg-green/10 text-green"
                              : "bg-red/10 text-red"
                          }`}
                        >
                          {formatOutcome(t.trade.outcome)}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {Math.abs(parseFloat(t.trade.shares)).toFixed(2)}
                      </td>
                      <td className="p-3 text-right font-medium">
                        {Math.abs(parseFloat(t.trade.cost)).toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted text-sm">
          No trades yet.{" "}
          <Link href="/" className="text-accent hover:underline">
            Browse markets
          </Link>{" "}
          to start trading.
        </div>
      )}
    </div>
  );
}
