import { db } from "@/db";
import { markets, users, coinTransactions } from "@/db/schema";
import { desc, sql, eq } from "drizzle-orm";
import { MarketStatusBadge } from "@/components/MarketStatusBadge";
import { AdminMarketActions } from "@/components/AdminMarketActions";
import Link from "next/link";

export default async function AdminMarketsPage() {
  const allMarkets = await db
    .select()
    .from(markets)
    .orderBy(desc(markets.createdAt));

  // Basic stats
  const [{ count: totalUsers }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(users);

  const [{ total: totalCoins }] = await db
    .select({
      total: sql<string>`coalesce(sum(cast(${users.balance} as numeric)), 0)`,
    })
    .from(users);

  const activeCount = allMarkets.filter((m) => m.status === "active").length;

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted">Active Markets</div>
          <div className="text-xl font-bold">{activeCount}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted">Total Markets</div>
          <div className="text-xl font-bold">{allMarkets.length}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted">Total Users</div>
          <div className="text-xl font-bold">{totalUsers}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted">Coins in Circulation</div>
          <div className="text-xl font-bold">
            {parseFloat(totalCoins).toLocaleString(undefined, {
              maximumFractionDigits: 0,
            })}
          </div>
        </div>
      </div>

      {/* Markets list */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">All Markets</h2>
        <Link
          href="/admin/markets/new"
          className="px-3 py-1.5 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover transition-colors"
        >
          + Create Market
        </Link>
      </div>

      {allMarkets.length > 0 ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="text-left p-3 font-medium">Title</th>
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="text-center p-3 font-medium">Type</th>
                  <th className="text-right p-3 font-medium">Target</th>
                  <th className="text-right p-3 font-medium">Resolves</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {allMarkets.map((market) => (
                  <tr
                    key={market.id}
                    className="border-b border-border last:border-0 hover:bg-card-hover"
                  >
                    <td className="p-3">
                      <Link
                        href={`/markets/${market.id}`}
                        className="text-accent hover:underline"
                      >
                        {market.title}
                      </Link>
                    </td>
                    <td className="p-3 text-center">
                      <MarketStatusBadge status={market.status} />
                    </td>
                    <td className="p-3 text-center capitalize">
                      {market.questionType}
                    </td>
                    <td className="p-3 text-right">
                      {Number(market.milestoneThreshold).toLocaleString()}
                    </td>
                    <td className="p-3 text-right text-muted">
                      {market.resolvesAt
                        ? new Date(market.resolvesAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="p-3 text-right">
                      <AdminMarketActions
                        marketId={market.id}
                        status={market.status}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted">
          No markets yet.{" "}
          <Link href="/admin/markets/new" className="text-accent hover:underline">
            Create your first market
          </Link>
        </div>
      )}
    </div>
  );
}
