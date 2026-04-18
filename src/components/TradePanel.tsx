"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import useSWR from "swr";
import { buyShares } from "@/lib/actions/trade";
import { sharesForCost, allPrices } from "@/lib/lmsr";
import { CoinSlider } from "./CoinSlider";
import { balanceFetcher, type BalanceData } from "@/lib/balance-fetcher";

const PRICE_STALENESS_THRESHOLD = 0.02;

export interface TradeResult {
  outcome: number;
  cost: number;
  shares: number;
  priceAfter: number;
}

interface StaleConfirm {
  payoutAtFreshPrices: number;
}

export interface TradePanelProps {
  marketId: string;
  prices: number[];       // [priceYes, priceNo]
  quantities: number[];   // [quantityYes, quantityNo]
  bParameter: number;
  userBalance?: number;   // override for balance; falls back to SWR or 500
  initialOutcome?: number;
  yesTooltip?: string;
  noTooltip?: string;
  onTradeSuccess?: (result: TradeResult) => void;
}

export function TradePanel({
  marketId,
  prices,
  quantities,
  bParameter,
  userBalance,
  initialOutcome,
  yesTooltip,
  noTooltip,
  onTradeSuccess,
}: TradePanelProps) {
  const [outcome, setOutcome] = useState<number>(initialOutcome ?? 0);
  const [amount, setAmount] = useState(10);
  const [localInput, setLocalInput] = useState("10");
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState("");
  const [balanceError, setBalanceError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [staleConfirm, setStaleConfirm] = useState<StaleConfirm | null>(null);
  const balanceErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: balanceData, error: balanceFetchError } = useSWR<BalanceData>(
    "/api/balance",
    balanceFetcher
  );
  // If balance fetch fails, fall back to userBalance prop or 500 (preserves pre-polish behavior).
  // Note: a failed fetch re-enables the slider at the fallback max — server rejects over-balance trades.
  const balance = balanceData?.balance ?? (userBalance ?? 500);
  const isBalanceLoading = !balanceData && !balanceFetchError;
  const sliderMax = balance;

  // Clean up balance error timer on unmount
  useEffect(() => {
    return () => {
      if (balanceErrorTimerRef.current) clearTimeout(balanceErrorTimerRef.current);
    };
  }, []);

  function flashBalanceError() {
    setBalanceError("Not enough coins");
    if (balanceErrorTimerRef.current) clearTimeout(balanceErrorTimerRef.current);
    balanceErrorTimerRef.current = setTimeout(() => setBalanceError(""), 1500);
  }

  function commitInput(raw: string) {
    const parsed = parseInt(raw, 10);
    const valid = isNaN(parsed) ? 1 : parsed;
    const clamped = Math.min(Math.max(valid, 1), sliderMax);
    if (clamped < valid) flashBalanceError();
    setAmount(clamped);
    setLocalInput(String(clamped));
    setIsEditing(false);
    setError("");
    setStaleConfirm(null);
  }

  // Client-side LMSR — synchronous, no API calls
  const ready = bParameter > 0;
  const payoutYes = ready && amount > 0 ? sharesForCost(quantities, bParameter, 0, amount) : 0;
  const payoutNo  = ready && amount > 0 ? sharesForCost(quantities, bParameter, 1, amount) : 0;

  let priceImpact = 0;
  if (ready && amount > 0) {
    const selectedShares = outcome === 0 ? payoutYes : payoutNo;
    const newQ = [...quantities];
    newQ[outcome] += selectedShares;
    const newPrices = allPrices(newQ, bParameter);
    priceImpact = newPrices[outcome] - prices[outcome];
  }

  function handleOutcomeChange(newOutcome: number) {
    setOutcome(newOutcome);
    setError("");
    setStaleConfirm(null);
  }

  function handleAmountChange(value: number) {
    setAmount(value);
    setLocalInput(String(value));
    setIsEditing(false);
    setError("");
    setStaleConfirm(null);
  }

  async function checkStaleness(): Promise<boolean> {
    try {
      const res = await fetch(`/api/markets/${marketId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("fetch failed");
      const fresh = await res.json();
      const outcomeDelta = Math.abs(
        (outcome === 0 ? fresh.priceYes : fresh.priceNo) - prices[outcome]
      );
      if (outcomeDelta > PRICE_STALENESS_THRESHOLD) {
        const freshPayout = sharesForCost(
          [fresh.quantityYes, fresh.quantityNo],
          fresh.bParameter,
          outcome,
          amount
        );
        setStaleConfirm({ payoutAtFreshPrices: freshPayout });
        return false;
      }
      return true;
    } catch {
      setError("Could not verify current price. Please try again.");
      return false;
    }
  }

  function executeBuy() {
    startTransition(async () => {
      const result = await buyShares(marketId, outcome, amount);
      if ("error" in result) {
        setError(result.error);
        setStaleConfirm(null);
        return;
      }
      // Compute priceAfter client-side using actual shares returned
      const newQ = [...quantities];
      newQ[outcome] += result.shares;
      const priceAfter = allPrices(newQ, bParameter)[outcome];
      setAmount(10);
      setLocalInput("10");
      setIsEditing(false);
      setError("");
      setStaleConfirm(null);
      onTradeSuccess?.({ outcome, cost: result.cost, shares: result.shares, priceAfter });
    });
  }

  async function handleBuy() {
    if (amount < 1) {
      setError("Minimum trade is 1 coin");
      return;
    }
    setError("");
    setStaleConfirm(null);
    const canProceed = await checkStaleness();
    if (canProceed) executeBuy();
  }

  const inputDisabled = !ready || isPending || isBalanceLoading;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h2 className="text-sm font-medium text-muted mb-3">Place a Trade</h2>

      {/* Outcome selector */}
      <div className="flex gap-2 mb-5">
        <div className="relative flex-1 group">
          <button
            onClick={() => handleOutcomeChange(0)}
            className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
              outcome === 0
                ? "bg-green text-white"
                : "bg-green/10 text-green hover:bg-green/20"
            }`}
          >
            YES {(prices[0] * 100).toFixed(0)}%
          </button>
          {yesTooltip && (
            <div className="absolute bottom-full left-0 mb-2 w-60 bg-black/90 text-white text-xs rounded-lg px-3 py-2 pointer-events-none opacity-0 group-hover:opacity-100 group-hover:delay-[2000ms] transition-opacity duration-150 z-50 leading-snug whitespace-normal">
              {yesTooltip}
            </div>
          )}
        </div>
        <div className="relative flex-1 group">
          <button
            onClick={() => handleOutcomeChange(1)}
            className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
              outcome === 1
                ? "bg-red text-white"
                : "bg-red/10 text-red hover:bg-red/20"
            }`}
          >
            NO {(prices[1] * 100).toFixed(0)}%
          </button>
          {noTooltip && (
            <div className="absolute bottom-full right-0 mb-2 w-60 bg-black/90 text-white text-xs rounded-lg px-3 py-2 pointer-events-none opacity-0 group-hover:opacity-100 group-hover:delay-[2000ms] transition-opacity duration-150 z-50 text-right leading-snug whitespace-normal">
              {noTooltip}
            </div>
          )}
        </div>
      </div>

      {/* Amount input + slider */}
      <div className="mb-4">
        {/* Coin amount text input */}
        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={isEditing ? localInput : String(amount)}
            disabled={inputDisabled}
            onChange={(e) => {
              setLocalInput(e.target.value);
              setIsEditing(true);
            }}
            onBlur={(e) => commitInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
            className="w-24 px-3 py-1.5 bg-background border border-border rounded-lg text-sm font-medium tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <span className="text-sm text-muted">coins</span>
          {balanceError && (
            <span className="text-xs text-red ml-auto">{balanceError}</span>
          )}
        </div>

        <CoinSlider
          value={amount}
          onChange={handleAmountChange}
          min={1}
          max={sliderMax}
          disabled={inputDisabled}
        />
      </div>

      {/* Real-time payout panel */}
      {ready && (
        <div className="bg-background rounded-lg p-3 mb-4 space-y-1.5 text-sm">
          <div className="flex justify-between items-center">
            <span className={outcome === 0 ? "text-foreground" : "text-muted"}>
              Payout if YES wins
            </span>
            <span className={`font-medium ${outcome === 0 ? "text-green" : "text-muted"}`}>
              {payoutYes.toFixed(1)} coins{outcome === 0 ? " ✓" : ""}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className={outcome === 1 ? "text-foreground" : "text-muted"}>
              Payout if NO wins
            </span>
            <span className={`font-medium ${outcome === 1 ? "text-red" : "text-muted"}`}>
              {payoutNo.toFixed(1)} coins{outcome === 1 ? " ✓" : ""}
            </span>
          </div>
          <div className="flex justify-between items-center pt-1.5 border-t border-border">
            <span className="text-muted">Price impact</span>
            <span className={`font-medium text-xs ${priceImpact >= 0 ? "text-green" : "text-red"}`}>
              {priceImpact >= 0 ? "+" : ""}{(priceImpact * 100).toFixed(2)}%
            </span>
          </div>
        </div>
      )}

      {/* Staleness warning */}
      {staleConfirm && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4 text-sm">
          <p className="font-medium text-amber-600 dark:text-amber-400 mb-2">
            Price moved! New payout: {staleConfirm.payoutAtFreshPrices.toFixed(1)} coins.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setStaleConfirm(null)}
              className="flex-1 py-1.5 text-xs border border-border rounded-lg hover:bg-card-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={executeBuy}
              disabled={isPending}
              className="flex-1 py-1.5 text-xs bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50"
            >
              Buy anyway
            </button>
          </div>
        </div>
      )}

      {/* Trade error */}
      {error && (
        <div className="text-sm text-red mb-3 p-2 bg-red/10 rounded-lg">
          {error}
        </div>
      )}

      {/* Buy button */}
      <button
        onClick={handleBuy}
        disabled={isPending || !ready || amount < 1 || !!staleConfirm}
        className={`w-full py-2.5 rounded-lg font-medium text-sm text-white transition-colors disabled:opacity-50 ${
          outcome === 0
            ? "bg-green hover:bg-green/80"
            : "bg-red hover:bg-red/80"
        }`}
      >
        {isPending ? "Buying..." : `Buy ${outcome === 0 ? "YES" : "NO"} — ${amount} coins`}
      </button>
    </div>
  );
}
