"use client";

import { useEffect, useRef, useState } from "react";
import { Drawer } from "vaul";
import useSWR from "swr";
import { TradePanel, type TradeResult } from "./TradePanel";
import { PriceChart } from "./PriceChart";
import { SellButton } from "./SellButton";
import { getUserPosition, type UserPosition } from "@/lib/actions/trade";
import type { UTCTimestamp } from "lightweight-charts";

interface BetSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marketId: string;
  prices: number[];
  initialOutcome?: number;
  title: string;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

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
  const [position, setPosition] = useState<UserPosition | null | "loading">("loading");

  // Fetch market data (price history) only when sheet is open
  const { data: marketData } = useSWR(
    open && marketId ? `/api/markets/${marketId}` : null,
    fetcher
  );

  const chartData: { time: UTCTimestamp; value: number }[] = marketData?.priceHistory
    ? marketData.priceHistory.map((p: { time: string; priceYes: number }) => ({
        time: (new Date(p.time).getTime() / 1000) as UTCTimestamp,
        value: p.priceYes,
      }))
    : [];

  // Fetch user position when sheet opens
  useEffect(() => {
    if (!open) return;
    setPosition("loading");
    getUserPosition(marketId).then((pos) => setPosition(pos));
  }, [open, marketId]);

  // Body scroll lock while sheet is open (prevents feed scrolling on iOS Safari)
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

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
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      container={containerRef?.current ?? undefined}
    >
      <Drawer.Portal container={containerRef?.current ?? undefined}>
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
              prices={prices}
              initialOutcome={initialOutcome}
              onTradeSuccess={handleTradeSuccess}
            />

            {/* Sell controls — only shown when user has a position */}
            {position !== "loading" && position !== null && (
              <div className="border-t border-border pt-4">
                <p className="text-xs text-muted mb-2">
                  Your position: {position.outcome === 0 ? "YES" : "NO"} —{" "}
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
