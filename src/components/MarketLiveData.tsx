"use client";

import useSWR from "swr";
import { useState, useEffect, useRef } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import type { Session } from "next-auth";
import type { MarketData } from "@/types/market";
import { TradePanel } from "@/components/TradePanel";
import { PriceChart } from "@/components/PriceChart";
import { VideoStatsChart } from "@/components/VideoStatsChart";
import { MarketStatusBadge } from "@/components/MarketStatusBadge";
import { CountdownTimer } from "@/components/CountdownTimer";
import { LastUpdated } from "@/components/LastUpdated";

async function fetcher(url: string): Promise<MarketData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch market data: ${res.status}`);
  return res.json();
}

interface MarketLiveDataProps {
  marketId: string;
  session: Session | null;
  initialData: MarketData;
  children?: React.ReactNode;
}

export function MarketLiveData({
  marketId,
  session,
  initialData,
  children,
}: MarketLiveDataProps) {
  const { data, mutate, isValidating } = useSWR<MarketData>(
    `/api/markets/${marketId}`,
    fetcher,
    { refreshInterval: 60_000, fallbackData: initialData }
  );

  // Track when data was last successfully fetched
  const [lastFetched, setLastFetched] = useState(() => new Date());
  const prevValidating = useRef(false);
  useEffect(() => {
    if (prevValidating.current && !isValidating) {
      setLastFetched(new Date());
    }
    prevValidating.current = isValidating;
  }, [isValidating]);

  // data is always defined because fallbackData is provided
  const market = data!;

  const resolvesAt = market.resolvesAt ? new Date(market.resolvesAt) : null;
  const milestoneNumber = Number(market.milestoneThreshold);

  const chartData = market.priceHistory.map((h) => ({
    time: Math.floor(new Date(h.time).getTime() / 1000) as UTCTimestamp,
    value: h.priceYes,
  }));

  const statsChartData = market.pollHistory
    .filter((p) =>
      market.questionType === "views" ? p.viewCount != null : p.likeCount != null
    )
    .map((p) => ({
      time: Math.floor(new Date(p.time).getTime() / 1000) as UTCTimestamp,
      value: (market.questionType === "views" ? p.viewCount : p.likeCount)!,
    }));

  const prices = [market.priceYes, market.priceNo];

  return (
    <>
      <div className="flex items-center gap-3 mb-4 mt-6">
        <MarketStatusBadge status={market.status} />
        {resolvesAt && <CountdownTimer target={resolvesAt} />}
        <div className="ml-auto">
          <LastUpdated updatedAt={isValidating ? lastFetched : lastFetched} />
        </div>
      </div>

      <h1 className="text-2xl font-bold mb-6">{market.title}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* View / Like trajectory */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h2 className="text-sm font-medium text-muted mb-3">
              {market.questionType === "views" ? "View" : "Like"} Count Trajectory
            </h2>
            {statsChartData.length > 0 ? (
              <VideoStatsChart
                data={statsChartData}
                milestone={milestoneNumber}
                metricLabel={market.questionType}
              />
            ) : (
              <div className="h-48 flex items-center justify-center text-muted text-sm">
                Poll data not yet available — chart will appear after the first polling interval
              </div>
            )}
          </div>

          {/* Channel history (server-rendered, passed as children) */}
          {children}

          {/* Price chart */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h2 className="text-sm font-medium text-muted mb-3">Price History</h2>
            {chartData.length > 0 ? (
              <PriceChart data={chartData} />
            ) : (
              <div className="h-48 flex items-center justify-center text-muted text-sm">
                No trades yet — chart will appear after the first trade
              </div>
            )}
          </div>

          {/* Market info */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h2 className="text-sm font-medium text-muted mb-3">Market Details</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-muted">Type</div>
                <div className="font-medium capitalize">
                  {market.questionType} milestone
                </div>
              </div>
              <div>
                <div className="text-muted">Target</div>
                <div className="font-medium">
                  {milestoneNumber.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-muted">Resolves</div>
                <div className="font-medium">
                  {resolvesAt ? resolvesAt.toLocaleDateString() : "TBD"}
                </div>
              </div>
            </div>
            {market.description && (
              <p className="text-sm text-muted mt-3">{market.description}</p>
            )}
          </div>

          {/* Recent trades */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h2 className="text-sm font-medium text-muted mb-3">Recent Trades</h2>
            {market.recentTrades.length > 0 ? (
              <div className="space-y-2">
                {market.recentTrades.map((trade) => (
                  <div
                    key={trade.id}
                    className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          trade.shares > 0
                            ? "bg-green/10 text-green"
                            : "bg-red/10 text-red"
                        }`}
                      >
                        {trade.shares > 0 ? "BUY" : "SELL"}
                      </span>
                      <span className="font-medium">
                        {trade.outcome === 1 ? "YES" : "NO"}
                      </span>
                      <span className="text-muted">
                        {Math.abs(trade.shares).toFixed(1)} shares
                      </span>
                    </div>
                    <div className="text-muted">
                      {Math.abs(trade.cost).toFixed(2)} coins
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-muted text-sm py-4">No trades yet</div>
            )}
          </div>
        </div>

        {/* Right column: odds + trade panel */}
        <div className="lg:col-span-1">
          <div className="sticky top-20">
            {/* Current odds */}
            <div className="bg-card border border-border rounded-xl p-4 mb-4">
              <h2 className="text-sm font-medium text-muted mb-3">Current Odds</h2>
              <div className="flex gap-3">
                <div className="flex-1 text-center p-3 bg-green/10 rounded-lg">
                  <div className="text-2xl font-bold text-green">
                    {(market.priceYes * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-muted mt-1">YES</div>
                </div>
                <div className="flex-1 text-center p-3 bg-red/10 rounded-lg">
                  <div className="text-2xl font-bold text-red">
                    {(market.priceNo * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-muted mt-1">NO</div>
                </div>
              </div>
            </div>

            {/* Trade panel */}
            {session?.user && market.status === "active" ? (
              <TradePanel
                marketId={market.id}
                prices={prices}
                onTradeSuccess={() => mutate()}
              />
            ) : market.status === "resolved" ? (
              <div className="bg-card border border-border rounded-xl p-4 text-center">
                <div className="text-lg font-bold mb-1">
                  Resolved:{" "}
                  <span className={market.outcome === 1 ? "text-green" : "text-red"}>
                    {market.outcome === 1 ? "YES" : "NO"}
                  </span>
                </div>
                <p className="text-sm text-muted">
                  This market has been resolved and payouts distributed.
                </p>
              </div>
            ) : !session?.user ? (
              <div className="bg-card border border-border rounded-xl p-4 text-center">
                <p className="text-sm text-muted mb-3">Sign in to start trading</p>
                <a
                  href="/auth/signin"
                  className="inline-block px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Sign In
                </a>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl p-4 text-center text-sm text-muted">
                Trading is not available for this market.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
