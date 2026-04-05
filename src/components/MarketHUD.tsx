"use client";

import useSWR, { useSWRConfig } from "swr";
import { useState, useEffect, useRef } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import type { Session } from "next-auth";
import type { MarketData } from "@/types/market";
import { TradePanel } from "@/components/TradePanel";
import type { TradeResult } from "@/components/TradePanel";
import { SellButton } from "@/components/SellButton";
import { MarketStatusBadge } from "@/components/MarketStatusBadge";
import { CountdownTimer } from "@/components/CountdownTimer";
import { LastUpdated } from "@/components/LastUpdated";
import { HaltCountdownBlock } from "@/components/HaltCountdownBlock";
import { ResolutionReveal } from "@/components/ResolutionReveal";
import { PostTradeShareCard } from "@/components/PostTradeShareCard";
import type { PostTradeResult } from "@/components/PostTradeShareCard";
import { ResolutionShareCard } from "@/components/ResolutionShareCard";
import type { UserPosition } from "@/lib/actions/trade";
import { marketFetcher } from "@/lib/market-fetcher";

interface MarketHUDProps {
  marketId: string;
  session: Session | null;
  initialData: MarketData;
}

export function MarketHUD({ marketId, session, initialData }: MarketHUDProps) {
  const { mutate: globalMutate } = useSWRConfig();

  const { data, mutate, isValidating } = useSWR<MarketData>(
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

  const market = data!;

  // Track when data was last successfully fetched
  const [lastFetched, setLastFetched] = useState(() => new Date());
  const prevValidating = useRef(false);
  useEffect(() => {
    if (prevValidating.current && !isValidating) {
      setLastFetched(new Date());
    }
    prevValidating.current = isValidating;
  }, [isValidating]);

  // User position — available from the API response for any status
  const userPosition: UserPosition | null = market.userPosition ?? null;

  // Post-trade share card state
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

  // Resolution share card state
  const [showResolutionShare, setShowResolutionShare] = useState(false);

  function handleRevealComplete() {
    if (userPosition !== null) {
      setShowResolutionShare(true);
    }
  }

  const isUrgentStatus = market.status === "halted" || market.status === "resolving";
  const resolvesAt = market.resolvesAt ? new Date(market.resolvesAt) : null;
  const prices = [market.priceYes, market.priceNo];

  const volumeTotal =
    market.priceHistory.length > 0
      ? market.priceHistory[market.priceHistory.length - 1].volumeTotal
      : 0;

  return (
    <>
      {/* Resolution share card modal */}
      {showResolutionShare && userPosition && market.outcome !== null && (
        <ResolutionShareCard
          marketTitle={market.title}
          outcome={market.outcome}
          userPosition={userPosition}
          onDismiss={() => setShowResolutionShare(false)}
        />
      )}

      {/* Status bar */}
      <div className="flex items-center gap-3 mb-4">
        <MarketStatusBadge
          status={market.status}
          pulsing={isUrgentStatus}
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

      {/* Status-driven action slot */}
      <div className="relative">
        {isUrgentStatus ? (
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
          <ResolutionReveal
            outcome={market.outcome}
            priceYes={market.priceYes}
            priceNo={market.priceNo}
            userPosition={userPosition}
            onRevealComplete={handleRevealComplete}
          />
        ) : market.status === "active" && session?.user ? (
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
            {userPosition && (
              <div className="border-t border-border pt-4 mt-4">
                <p className="text-xs text-muted mb-2">
                  Your position:{" "}
                  <span className={userPosition.outcome === 0 ? "text-green" : "text-red"}>
                    {userPosition.outcome === 0 ? "YES" : "NO"}
                  </span>{" "}
                  — {userPosition.shares.toFixed(1)} shares
                </p>
                <SellButton
                  marketId={market.id}
                  outcome={userPosition.outcome}
                  maxShares={userPosition.shares}
                />
              </div>
            )}
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
    </>
  );
}
