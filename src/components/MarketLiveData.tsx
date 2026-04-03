"use client";

import useSWR, { useSWRConfig } from "swr";
import { useState, useEffect, useRef } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import type { Session } from "next-auth";
import type { MarketData } from "@/types/market";
import type { UserPosition } from "@/lib/actions/trade";
import { getUserPosition } from "@/lib/actions/trade";
import { TradePanel } from "@/components/TradePanel";
import type { TradeResult } from "@/components/TradePanel";
import { PriceChart } from "@/components/PriceChart";
import { VideoStatsChart } from "@/components/VideoStatsChart";
import { MarketStatusBadge } from "@/components/MarketStatusBadge";
import { CountdownTimer } from "@/components/CountdownTimer";
import { LastUpdated } from "@/components/LastUpdated";
import { HaltCountdownBlock } from "@/components/HaltCountdownBlock";
import { ResolutionReveal } from "@/components/ResolutionReveal";
import { PostTradeShareCard } from "@/components/PostTradeShareCard";
import type { PostTradeResult } from "@/components/PostTradeShareCard";
import { ResolutionShareCard } from "@/components/ResolutionShareCard";
import { Toast } from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import { marketFetcher } from "@/lib/market-fetcher";

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
  const { mutate: globalMutate } = useSWRConfig();

  const { data, mutate, isValidating } = useSWR<MarketData>(
    `/api/markets/${marketId}`,
    marketFetcher,
    {
      // Adaptive polling: SWR re-evaluates the function each time data arrives
      refreshInterval: (latestData) => {
        const status = latestData?.status ?? initialData.status;
        return status === "halted" || status === "resolving" ? 10_000 : 60_000;
      },
      fallbackData: initialData,
    }
  );

  // Track when data was last successfully fetched
  const [lastFetched, setLastFetched] = useState(() => new Date());
  const prevValidating = useRef(false);
  useEffect(() => {
    if (prevValidating.current && !isValidating) {
      setLastFetched(new Date()); // intentional: update timestamp after revalidation completes
    }
    prevValidating.current = isValidating;
  }, [isValidating]);

  // data is always defined because fallbackData is provided
  const market = data!;

  // Derived: is market in an urgent status?
  const isUrgentStatus = market.status === "halted" || market.status === "resolving";

  // ── Toast on halt transition ──────────────────────────────────────────────────
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

  // ── User position fetch on resolution ────────────────────────────────────────
  // undefined = not fetched yet, null = fetched but no position
  const [userPosition, setUserPosition] = useState<UserPosition | null | undefined>(
    undefined
  );
  const positionFetchedRef = useRef(false);

  useEffect(() => {
    if (
      market.status === "resolved" &&
      session?.user &&
      !positionFetchedRef.current
    ) {
      positionFetchedRef.current = true;
      getUserPosition(marketId)
        .then((pos) => setUserPosition(pos))
        .catch(() => setUserPosition(null)); // non-blocking — position panel stays hidden
    }
  }, [market.status, session?.user, marketId]);

  // ── Post-trade share card state ───────────────────────────────────────────────
  const [postTradeResult, setPostTradeResult] = useState<PostTradeResult | null>(null);

  function handleTradeSuccess(result: TradeResult) {
    mutate();
    globalMutate("/api/balance");
    setPostTradeResult({
      outcome: result.outcome,
      cost: result.cost,
      shares: result.shares,
      priceAfter: result.priceAfter,
    });
  }

  // ── Resolution share card state ───────────────────────────────────────────────
  const [showResolutionShare, setShowResolutionShare] = useState(false);

  function handleRevealComplete() {
    if (userPosition !== null && userPosition !== undefined) {
      setShowResolutionShare(true);
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────────
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

  // Volume total from last price history entry
  const volumeTotal =
    market.priceHistory.length > 0
      ? market.priceHistory[market.priceHistory.length - 1].volumeTotal
      : 0;

  return (
    <>
      {/* Toast — no third-party dependency, fires once per halt transition */}
      <Toast show={toast.show} message={toast.message} onDismiss={toast.dismiss} />

      {/* Resolution share card modal */}
      {showResolutionShare && userPosition && market.outcome !== null && (
        <ResolutionShareCard
          marketTitle={market.title}
          outcome={market.outcome}
          userPosition={userPosition}
          onDismiss={() => setShowResolutionShare(false)}
        />
      )}

      <div className="flex items-center gap-3 mb-4 mt-6">
        <MarketStatusBadge
          status={market.status}
          pulsing={market.status === "halted" || market.status === "resolving"}
        />
        {resolvesAt && market.status !== "resolved" && market.status !== "cancelled" && (
          <CountdownTimer
            target={resolvesAt}
            variant={isUrgentStatus ? "urgent" : "default"}
          />
        )}
        <div className="ml-auto">
          <LastUpdated updatedAt={lastFetched} />
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

        {/* Right column: odds + status-driven action slot */}
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

            {/* Right-column action slot — status-driven branching */}
            <div className="relative">
              {(market.status === "halted" || market.status === "resolving") ? (
                // HALT WINDOW: FINAL CALL countdown block
                resolvesAt ? (
                  <HaltCountdownBlock
                    resolvesAt={resolvesAt}
                    priceYes={market.priceYes}
                    priceNo={market.priceNo}
                    volumeTotal={volumeTotal}
                  />
                ) : (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-center text-sm text-amber-500 font-medium">
                    Trading locked — resolution imminent
                  </div>
                )
              ) : market.status === "resolved" && market.outcome !== null ? (
                // RESOLUTION: animated reveal + position-aware outcome
                <ResolutionReveal
                  outcome={market.outcome}
                  priceYes={market.priceYes}
                  priceNo={market.priceNo}
                  userPosition={userPosition ?? null}
                  onRevealComplete={handleRevealComplete}
                />
              ) : market.status === "active" && session?.user ? (
                // ACTIVE: trade panel with optional post-trade share card overlay
                <>
                  {postTradeResult && (
                    <PostTradeShareCard
                      result={postTradeResult}
                      onDismiss={() => setPostTradeResult(null)}
                    />
                  )}
                  <TradePanel
                    marketId={market.id}
                    prices={prices}
                    onTradeSuccess={handleTradeSuccess}
                  />
                </>
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
      </div>
    </>
  );
}
