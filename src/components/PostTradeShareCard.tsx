"use client";

import { useState, useEffect } from "react";

export interface PostTradeResult {
  outcome: number; // 0=YES, 1=NO
  cost: number;
  shares: number;
  priceAfter: number;
}

interface PostTradeShareCardProps {
  result: PostTradeResult;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 4_000;

/**
 * Overlay on the TradePanel container shown after a successful trade.
 * Auto-dismisses after 4 s or on tap/click.
 * Includes a Share button using the Web Share API with clipboard fallback.
 */
export function PostTradeShareCard({ result, onDismiss }: PostTradeShareCardProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const isYes = result.outcome === 0;
  const impliedPct = (result.priceAfter * 100).toFixed(1);
  const potentialPayout = result.shares.toFixed(2);

  async function handleShare() {
    const url = window.location.href;
    const text = `I just bet ${isYes ? "YES" : "NO"} at ${impliedPct}% implied odds on Virality! Potential payout: ${potentialPayout} coins.`;
    try {
      await navigator.share({ url, text });
    } catch (err) {
      // AbortError = user cancelled share sheet; clipboard fallback for other errors
      if (err instanceof Error && err.name !== "AbortError") {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2_000);
        } catch {
          // clipboard write can fail (e.g. insecure context) — ignore
        }
      }
    }
  }

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center rounded-xl"
      onClick={onDismiss}
    >
      {/* Semi-transparent backdrop */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm rounded-xl" />

      <div
        className="relative z-10 w-full max-w-xs bg-card border border-border rounded-2xl p-5 shadow-xl text-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Side badge */}
        <div
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold mb-3 ${
            isYes ? "bg-green/10 text-green" : "bg-red/10 text-red"
          }`}
        >
          <span className="text-base">{isYes ? "✓" : "✗"}</span>
          {isYes ? "YES" : "NO"}
        </div>

        <h3 className="font-bold text-lg mb-4">Trade Placed!</h3>

        <div className="space-y-2 text-sm mb-5 text-left bg-background rounded-xl p-3">
          <div className="flex justify-between">
            <span className="text-muted">Amount wagered</span>
            <span className="font-medium">{result.cost.toFixed(2)} coins</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Implied probability</span>
            <span className="font-medium">{impliedPct}%</span>
          </div>
          <div className="flex justify-between border-t border-border pt-2 mt-2">
            <span className="text-muted">Potential payout</span>
            <span className="font-medium text-green">{potentialPayout} coins</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleShare}
            className="flex-1 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
          >
            {copied ? "Link copied!" : "Share"}
          </button>
          <button
            onClick={onDismiss}
            className="px-3 py-2 rounded-lg border border-border text-sm text-muted hover:bg-card-hover transition-colors"
          >
            Dismiss
          </button>
        </div>

        <p className="text-xs text-muted mt-3">Auto-dismisses in a moment…</p>
      </div>
    </div>
  );
}
