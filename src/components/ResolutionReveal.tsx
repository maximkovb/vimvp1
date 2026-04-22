"use client";

import { useState, useEffect } from "react";
import type { UserPosition } from "@/lib/actions/trade";

interface ResolutionRevealProps {
  /** 0 = YES resolved, 1 = NO resolved */
  outcome: number;
  priceYes: number;
  priceNo: number;
  userPosition: UserPosition | null;
  /** Called after the animation completes and confetti fires (if applicable). */
  onRevealComplete?: () => void;
}

/**
 * Animated resolution reveal panel for the right-column slot in MarketLiveData.
 *
 * Phase 1 (0–500 ms): odds bars animate toward 0%/100% in the winning direction.
 * Phase 2 (after 500 ms): outcome label fades in.
 * Confetti fires only when the user has a winning position.
 */
export function ResolutionReveal({
  outcome,
  priceYes,
  priceNo,
  userPosition,
  onRevealComplete,
}: ResolutionRevealProps) {
  // 0 = initial (pre-animation), 1 = bars animated, 2 = label visible
  const [phase, setPhase] = useState<0 | 1 | 2>(0);

  const yesWon = outcome === 0; // outcome 0 = YES wins
  const userWon = userPosition !== null && userPosition.outcome === outcome;

  // Winning payout: shares × 1 coin each (LMSR: winning shares pay 1 coin)
  const payout = userPosition ? Math.round(userPosition.shares) : 0;
  const invested = userPosition
    ? userPosition.shares * userPosition.avgCostBasis
    : 0;
  const profit = payout - invested;

  useEffect(() => {
    // Phase 1: start bar animation immediately on mount
    const t1 = setTimeout(() => setPhase(1), 50); // tiny delay to allow initial render

    // Phase 2: fade in label after bars finish
    const t2 = setTimeout(() => setPhase(2), 600);

    // Fire confetti and notify parent after full reveal
    const t3 = setTimeout(async () => {
      if (userWon) {
        try {
          const confetti = (await import("canvas-confetti")).default;
          confetti({
            particleCount: 120,
            spread: 70,
            origin: { y: 0.6 },
          });
        } catch {
          // confetti is purely cosmetic — ignore import failures
        }
      }
      onRevealComplete?.();
    }, 1_000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [userWon, onRevealComplete]);

  // Animated bar widths — on phase 0 use actual prices, on phase 1+ snap to 0/100
  const yesWidth = phase >= 1 ? (yesWon ? 100 : 0) : priceYes * 100;
  const noWidth = phase >= 1 ? (yesWon ? 0 : 100) : priceNo * 100;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h2 className="text-sm font-medium text-muted mb-4">Market Resolved</h2>

      {/* Animated odds bars */}
      <div className="flex gap-2 mb-5">
        <div
          className="text-center py-2.5 rounded-lg bg-green/10 overflow-hidden transition-all duration-500 ease-in-out"
          style={{ flex: yesWidth, minWidth: yesWidth > 0 ? "3rem" : "0" }}
        >
          {yesWidth > 10 && (
            <div className="text-sm font-bold text-green whitespace-nowrap px-1">
              YES {yesWidth.toFixed(0)}%
            </div>
          )}
        </div>
        <div
          className="text-center py-2.5 rounded-lg bg-red/10 overflow-hidden transition-all duration-500 ease-in-out"
          style={{ flex: noWidth, minWidth: noWidth > 0 ? "3rem" : "0" }}
        >
          {noWidth > 10 && (
            <div className="text-sm font-bold text-red whitespace-nowrap px-1">
              NO {noWidth.toFixed(0)}%
            </div>
          )}
        </div>
      </div>

      {/* Outcome label — fades in at phase 2 */}
      <div
        className={`text-center transition-opacity duration-500 ${
          phase >= 2 ? "opacity-100" : "opacity-0"
        }`}
      >
        <div
          className={`text-4xl font-bold mb-2 ${yesWon ? "text-green" : "text-red"}`}
        >
          {yesWon ? "YES ✓" : "NO ✗"}
        </div>
        <p className="text-sm text-muted">This market has been resolved.</p>

        {/* Position-aware outcome panel */}
        {userPosition && (
          <div
            className={`mt-4 p-3 rounded-xl border ${
              userWon
                ? "bg-green/10 border-green/30"
                : "bg-red/10 border-red/30"
            }`}
          >
            <p
              className={`text-lg font-bold ${userWon ? "text-green" : "text-red"}`}
            >
              {userWon
                ? `You won +${payout} coins`
                : `You lost ${Math.abs(Math.round(profit))} coins`}
            </p>
            <p className="text-xs text-muted mt-1">
              {userPosition.outcome === 0 ? "YES" : "NO"} position ·{" "}
              {userPosition.shares.toFixed(2)} shares ·{" "}
              {(userPosition.avgCostBasis * 100).toFixed(1)}¢ avg entry
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
