"use client";

import { useEffect, useRef } from "react";
import { Drawer } from "vaul";
import { TradePanel, type TradeResult } from "./TradePanel";

interface BetSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marketId: string;
  prices: number[];
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

          {/* Trade panel — scrollable */}
          <div className="overflow-y-auto flex-1 p-5">
            <TradePanel
              marketId={marketId}
              prices={prices}
              initialOutcome={initialOutcome}
              onTradeSuccess={handleTradeSuccess}
            />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
