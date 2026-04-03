"use client";

import { useState } from "react";
import type { UserPosition } from "@/lib/actions/trade";

interface ResolutionShareCardProps {
  marketTitle: string;
  /** 0 = YES resolved, 1 = NO resolved */
  outcome: number;
  userPosition: UserPosition;
  onDismiss: () => void;
}

/**
 * Modal-style overlay shown after market resolution when the user has a position.
 * Does NOT auto-dismiss. Shows outcome, market title, original call, entry odds,
 * payout/loss, and Share + Copy link buttons.
 */
export function ResolutionShareCard({
  marketTitle,
  outcome,
  userPosition,
  onDismiss,
}: ResolutionShareCardProps) {
  const [copied, setCopied] = useState(false);

  const userWon = userPosition.outcome === outcome;
  const yesWon = outcome === 0;
  const payout = Math.round(userPosition.shares); // LMSR: 1 coin per winning share
  const invested = userPosition.shares * userPosition.avgCostBasis;
  const netProfit = payout - invested;

  const truncatedTitle =
    marketTitle.length > 60 ? marketTitle.slice(0, 57) + "…" : marketTitle;

  async function handleShare() {
    const url = window.location.href;
    const resultText = userWon
      ? `I won +${payout} coins on Virality! "${truncatedTitle}"`
      : `I bet ${userPosition.outcome === 0 ? "YES" : "NO"} on "${truncatedTitle}" — it resolved ${yesWon ? "YES" : "NO"}.`;
    try {
      await navigator.share({ url, text: resultText });
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        await handleCopyLink();
      }
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // clipboard write can fail (e.g. insecure context) — ignore
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
        onClick={onDismiss}
      />

      <div className="relative z-10 w-full max-w-sm bg-card border border-border rounded-2xl p-6 shadow-2xl text-center">
        {/* Won/Lost headline */}
        <div
          className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold mb-4 ${
            userWon
              ? "bg-green/10 text-green"
              : "bg-red/10 text-red"
          }`}
        >
          <span className="text-lg">{userWon ? "🏆" : "💸"}</span>
          {userWon ? "You Won!" : "You Lost"}
        </div>

        {/* Market title */}
        <h3 className="font-semibold text-sm text-muted mb-4 leading-snug">
          {truncatedTitle}
        </h3>

        {/* Stats */}
        <div className="space-y-2 text-sm bg-background rounded-xl p-4 mb-5 text-left">
          <div className="flex justify-between">
            <span className="text-muted">Your call</span>
            <span
              className={`font-bold ${userPosition.outcome === 0 ? "text-green" : "text-red"}`}
            >
              {userPosition.outcome === 0 ? "YES" : "NO"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Entry odds</span>
            <span className="font-medium">
              {(userPosition.avgCostBasis * 100).toFixed(1)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Market resolved</span>
            <span
              className={`font-bold ${yesWon ? "text-green" : "text-red"}`}
            >
              {yesWon ? "YES" : "NO"}
            </span>
          </div>
          <div className="flex justify-between border-t border-border pt-2 mt-2">
            <span className="text-muted">{userWon ? "Payout" : "Loss"}</span>
            <span
              className={`font-bold text-base ${userWon ? "text-green" : "text-red"}`}
            >
              {userWon
                ? `+${payout} coins`
                : `${Math.abs(Math.round(netProfit))} coins`}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={handleShare}
            className="flex-1 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
          >
            Share
          </button>
          <button
            onClick={handleCopyLink}
            className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium hover:bg-card-hover transition-colors"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>

        <button
          onClick={onDismiss}
          className="w-full py-2 text-sm text-muted hover:text-foreground transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
