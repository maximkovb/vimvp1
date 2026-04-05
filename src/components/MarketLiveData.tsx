"use client";

import useSWR from "swr";
import { useState, useEffect, useRef } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import type { MarketData } from "@/types/market";
import { VideoStatsChart } from "@/components/VideoStatsChart";
import { PriceChart } from "@/components/PriceChart";
import { Toast } from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import { marketFetcher } from "@/lib/market-fetcher";

interface MarketLiveDataProps {
  marketId: string;
  initialData: MarketData;
  children?: React.ReactNode;
}

export function MarketLiveData({
  marketId,
  initialData,
  children,
}: MarketLiveDataProps) {
  const { data, isValidating } = useSWR<MarketData>(
    `/api/markets/${marketId}`,
    marketFetcher,
    {
      refreshInterval: (latestData) => {
        const status = latestData?.status ?? initialData.status;
        return status === "halted" || status === "resolving" ? 10_000 : 60_000;
      },
      fallbackData: initialData,
    }
  );

  // Track when data was last successfully fetched (used for Toast timing only)
  const prevValidating = useRef(false);
  useEffect(() => {
    prevValidating.current = isValidating;
  }, [isValidating]);

  const market = data!;

  // ── Toast on halt transition ──────────────────────────────────────────────
  const prevStatusRef = useRef<string>(initialData.status);
  const toast = useToast();

  useEffect(() => {
    const prev = prevStatusRef.current;
    const current = market.status;
    prevStatusRef.current = current;

    if (prev === "active" && (current === "halted" || current === "resolving")) {
      const target = market.resolvesAt ? new Date(market.resolvesAt) : null;
      const remaining = target ? target.getTime() - Date.now() : 0;
      const mins = Math.floor(remaining / 60_000);
      const secs = Math.floor((remaining % 60_000) / 1_000);
      const timeLabel = `${mins}:${secs.toString().padStart(2, "0")}`;
      toast.trigger(`Trading locked — resolves in ${timeLabel}`);
    }
  }, [market.status, market.resolvesAt, toast]);

  // ── Derived values ────────────────────────────────────────────────────────
  const milestoneNumber = Number(market.milestoneThreshold);
  const resolvesAt = market.resolvesAt ? new Date(market.resolvesAt) : null;

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

  return (
    <>
      <Toast show={toast.show} message={toast.message} onDismiss={toast.dismiss} />

      <div className="space-y-6">
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
    </>
  );
}
