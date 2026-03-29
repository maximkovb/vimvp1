"use client";

import { useState, useTransition, useRef } from "react";
import { buyShares, previewTrade, type TradePreview } from "@/lib/actions/trade";

interface TradePanelProps {
  marketId: string;
  prices: number[];
  onTradeSuccess?: () => void;
}

export function TradePanel({ marketId, prices, onTradeSuccess }: TradePanelProps) {
  const [outcome, setOutcome] = useState<number>(0); // 0=YES, 1=NO
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<TradePreview | null>(null);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const previewTimerRef = useRef<NodeJS.Timeout | null>(null);

  function handleAmountChange(value: string) {
    setAmount(value);
    setError("");
    setPreview(null);

    const numAmount = parseFloat(value);
    if (!numAmount || numAmount <= 0) return;

    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(async () => {
      const result = await previewTrade(marketId, outcome, numAmount);
      if ("error" in result) {
        setError(result.error);
      } else {
        setPreview(result);
      }
    }, 400);
  }

  async function handleOutcomeChange(newOutcome: number) {
    setOutcome(newOutcome);
    setPreview(null);
    if (amount) {
      const numAmount = parseFloat(amount);
      if (numAmount > 0) {
        const result = await previewTrade(marketId, newOutcome, numAmount);
        if ("error" in result) {
          setError(result.error);
        } else {
          setPreview(result);
        }
      }
    }
  }

  function handleBuy() {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount < 1) {
      setError("Minimum trade is 1 coin");
      return;
    }

    startTransition(async () => {
      const result = await buyShares(marketId, outcome, numAmount);
      if ("error" in result) {
        setError(result.error);
      } else {
        setAmount("");
        setPreview(null);
        setError("");
        onTradeSuccess?.();
      }
    });
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h2 className="text-sm font-medium text-muted mb-3">Place a Trade</h2>

      {/* Outcome selector */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => handleOutcomeChange(0)}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
            outcome === 0
              ? "bg-green text-white"
              : "bg-green/10 text-green hover:bg-green/20"
          }`}
        >
          YES {(prices[0] * 100).toFixed(0)}%
        </button>
        <button
          onClick={() => handleOutcomeChange(1)}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
            outcome === 1
              ? "bg-red text-white"
              : "bg-red/10 text-red hover:bg-red/20"
          }`}
        >
          NO {(prices[1] * 100).toFixed(0)}%
        </button>
      </div>

      {/* Amount input */}
      <div className="mb-4">
        <label className="block text-xs text-muted mb-1.5">
          Amount (coins)
        </label>
        <input
          type="number"
          value={amount}
          onChange={(e) => handleAmountChange(e.target.value)}
          placeholder="Enter amount..."
          min="1"
          step="1"
          className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent text-sm"
        />
        <div className="flex gap-2 mt-2">
          {[10, 25, 50, 100].map((preset) => (
            <button
              key={preset}
              onClick={() => handleAmountChange(preset.toString())}
              className="flex-1 py-1 text-xs bg-background border border-border rounded hover:bg-card-hover transition-colors"
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div className="bg-background rounded-lg p-3 mb-4 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Est. shares</span>
            <span className="font-medium">{preview.shares.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Avg. price</span>
            <span className="font-medium">
              {(preview.avgPrice * 100).toFixed(1)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Price impact</span>
            <span
              className={`font-medium ${
                preview.priceImpact > 0 ? "text-green" : "text-red"
              }`}
            >
              {preview.priceImpact > 0 ? "+" : ""}
              {(preview.priceImpact * 100).toFixed(2)}%
            </span>
          </div>
          <div className="flex justify-between pt-1.5 border-t border-border">
            <span className="text-muted">Potential payout</span>
            <span className="font-medium text-green">
              {preview.shares.toFixed(2)} coins
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-sm text-red mb-3 p-2 bg-red/10 rounded-lg">
          {error}
        </div>
      )}

      {/* Buy button */}
      <button
        onClick={handleBuy}
        disabled={isPending || !amount || parseFloat(amount) < 1}
        className={`w-full py-2.5 rounded-lg font-medium text-sm text-white transition-colors disabled:opacity-50 ${
          outcome === 0
            ? "bg-green hover:bg-green/80"
            : "bg-red hover:bg-red/80"
        }`}
      >
        {isPending
          ? "Buying..."
          : `Buy ${outcome === 0 ? "YES" : "NO"} — ${amount || "0"} coins`}
      </button>
    </div>
  );
}
