"use client";

import { useEffect, useRef } from "react";
import { Drawer } from "vaul";
import useSWR from "swr";
import { marketFetcher } from "@/lib/market-fetcher";
import { TradePanel, type TradeResult } from "./TradePanel";
import { formatOutcome } from "@/lib/format";
import { PriceChart } from "./PriceChart";
import { SellButton } from "./SellButton";
import type { MarketData } from "@/types/market";
import type { UTCTimestamp } from "lightweight-charts";

interface BetSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marketId: string;
  prices: number[]; // SSR-derived initial skeleton; replaced by live prices once SWR resolves
  initialOutcome?: number;
  title: string;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

export function BetSheet({
  open,
  onOpenChange,
  marketId,
  prices,
  initialOutcome,
  title,
  containerRef,
}: BetSheetProps) {
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch market data (live prices + price history + user position) when sheet is open.
  // Uses the shared fetcher so SWR deduplicates with other components on the same key.
  const { data: marketData } = useSWR<MarketData>(
    open && marketId ? `/api/markets/${marketId}` : null,
    marketFetcher
  );

  // Use live prices from the API; fall back to SSR prop only while loading
  const livePrices: number[] = marketData
    ? [marketData.priceYes, marketData.priceNo]
    : prices;

  const chartData: { time: UTCTimestamp; value: number }[] = marketData?.priceHistory
    ? marketData.priceHistory.map((p) => ({
        time: (new Date(p.time).getTime() / 1000) as UTCTimestamp,
        value: p.priceYes,
      }))
    : [];

  // Position comes from the API response — no separate server action call needed
  const position = marketData?.userPosition ?? null;

  // Scroll lock: target the actual scrollable feed container, not document.body.
  // document.body overflow:hidden is ignored by iOS Safari when the scroll is on a child element.
  useEffect(() => {
    const el = containerRef?.current;
    if (!el) return;
    if (open) {
      el.style.overflow = "hidden";
    } else {
      el.style.overflow = "";
    }
    return () => {
      el.style.overflow = "";
    };
  }, [open, containerRef]);

  function handleTradeSuccess(_result: TradeResult) {
    // Auto-dismiss after 1.5s
    successTimerRef.current = setTimeout(() => {
      onOpenChange(false);
    }, 1500);
  }

  // Clean up timer if sheet closes manually
  useEffect(() => {
    if (!open && successTimerRef.current) {
      clearTimeout(successTimerRef.current);
    }
  }, [open]);

  return (
    // No container prop — vaul portals to document.body for correct fixed positioning and focus trap
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border rounded-t-2xl max-h-[90vh] flex flex-col outline-none"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-2 shrink-0">
            <div className="w-10 h-1 bg-border rounded-full" />
          </div>

          {/* Market title */}
          <div className="px-5 pb-3 shrink-0 border-b border-border">
            <p className="text-sm text-muted line-clamp-2">{title}</p>
          </div>

          {/* Scrollable body */}
          <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-5">
            {/* Price chart */}
            {chartData.length > 0 ? (
              <div>
                <p className="text-xs text-muted mb-2">YES price history</p>
                <PriceChart data={chartData} />
              </div>
            ) : (
              <div className="h-[200px] bg-background rounded-lg animate-pulse" />
            )}

            <TradePanel
              marketId={marketId}
              prices={livePrices}
              initialOutcome={initialOutcome}
              onTradeSuccess={handleTradeSuccess}
            />

            {/* Sell controls — shown when the API confirms the user holds shares */}
            {position !== null && (
              <div className="border-t border-border pt-4">
                <p className="text-xs text-muted mb-2">
                  Your position: {formatOutcome(position.outcome)} —{" "}
                  {position.shares.toFixed(1)} shares
                </p>
                <SellButton
                  marketId={marketId}
                  outcome={position.outcome}
                  maxShares={position.shares}
                />
              </div>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
