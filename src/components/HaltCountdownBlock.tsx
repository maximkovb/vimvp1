"use client";

import { CountdownTimer } from "@/components/CountdownTimer";

interface HaltCountdownBlockProps {
  resolvesAt: Date;
  priceYes: number;
  priceNo: number;
  /**
   * Total volume from the last entry in priceHistory.volumeTotal.
   * Updated on each SWR revalidation via the parent.
   */
  volumeTotal: number;
}

/**
 * Renders in the right-column slot of MarketLiveData when market.status is
 * "halted" or "resolving". Displays the countdown to resolution, locked
 * YES/NO odds (frozen at halt time), live total volume, and an amber label.
 *
 * volumeTotal is sourced from `market.priceHistory` last entry's `volumeTotal`
 * field which is updated on each SWR revalidation cycle.
 */
export function HaltCountdownBlock({
  resolvesAt,
  priceYes,
  priceNo,
  volumeTotal,
}: HaltCountdownBlockProps) {
  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
      {/* Amber label */}
      <div className="flex items-center gap-2 mb-4">
        <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
        <p className="text-amber-500 font-semibold text-sm tracking-wide uppercase">
          Resolving soon — trading locked
        </p>
      </div>

      {/* Large countdown */}
      <div className="text-center mb-5">
        <p className="text-xs text-muted mb-1 uppercase tracking-wide">Time to resolution</p>
        <div className="text-3xl font-bold text-amber-500">
          <CountdownTimer target={resolvesAt} variant="urgent" />
        </div>
      </div>

      {/* Locked odds */}
      <div className="mb-4">
        <p className="text-xs text-muted mb-2 uppercase tracking-wide">Locked Odds</p>
        <div className="flex gap-2">
          <div className="flex-1 text-center py-2.5 rounded-lg bg-green/10 border border-green/20">
            <div className="text-xl font-bold text-green">
              {(priceYes * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-muted mt-0.5">YES</div>
          </div>
          <div className="flex-1 text-center py-2.5 rounded-lg bg-red/10 border border-red/20">
            <div className="text-xl font-bold text-red">
              {(priceNo * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-muted mt-0.5">NO</div>
          </div>
        </div>
      </div>

      {/* Total volume */}
      <div className="text-center border-t border-amber-500/20 pt-3">
        <p className="text-xs text-muted">Total volume traded</p>
        <p className="text-lg font-semibold text-amber-500">
          {volumeTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} coins
        </p>
      </div>
    </div>
  );
}
