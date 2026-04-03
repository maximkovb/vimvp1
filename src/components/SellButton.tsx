"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { sellShares } from "@/lib/actions/trade";

interface SellButtonProps {
  marketId: string;
  outcome: number;
  maxShares: number;
}

export function SellButton({ marketId, outcome, maxShares }: SellButtonProps) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [showModal, setShowModal] = useState(false);
  const [shares, setShares] = useState(maxShares.toFixed(1));
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSell() {
    const numShares = parseFloat(shares);
    if (!numShares || numShares <= 0) {
      setError("Enter a valid amount");
      return;
    }
    if (numShares > maxShares) {
      setError(`Max ${maxShares.toFixed(1)} shares`);
      return;
    }

    startTransition(async () => {
      const result = await sellShares(marketId, outcome, numShares);
      if ("error" in result) {
        setError(result.error);
      } else {
        setShowModal(false);
        mutate("/api/balance");
        router.refresh();
      }
    });
  }

  if (!showModal) {
    return (
      <button
        onClick={() => setShowModal(true)}
        className="px-2 py-1 text-xs bg-red/10 text-red rounded hover:bg-red/20 transition-colors"
      >
        Sell
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-xl p-6 w-80">
        <h3 className="font-semibold mb-4">Sell Shares</h3>
        <div className="mb-3">
          <label className="text-xs text-muted">
            Shares to sell (max {maxShares.toFixed(1)})
          </label>
          <input
            type="number"
            value={shares}
            onChange={(e) => {
              setShares(e.target.value);
              setError("");
            }}
            max={maxShares}
            step="0.1"
            className="w-full px-3 py-2 mt-1 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        {error && (
          <p className="text-sm text-red mb-3">{error}</p>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => setShowModal(false)}
            className="flex-1 py-2 text-sm border border-border rounded-lg hover:bg-card-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSell}
            disabled={isPending}
            className="flex-1 py-2 text-sm bg-red text-white rounded-lg hover:bg-red/80 disabled:opacity-50 transition-colors"
          >
            {isPending ? "Selling..." : "Confirm Sell"}
          </button>
        </div>
      </div>
    </div>
  );
}
