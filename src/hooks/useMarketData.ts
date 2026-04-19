import { useCallback } from "react";
import useSWR from "swr";
import type { MarketData } from "@/types/market";
import { marketFetcher } from "@/lib/market-fetcher";

/**
 * Fetches and subscribes to live market data via SWR.
 * Adaptive refresh interval: 10s when market is halted/resolving, 60s otherwise.
 *
 * IMPORTANT: refreshInterval must be a stable function reference (useCallback).
 * SWR's polling effect lists refreshInterval in its dependency array. If the
 * function is recreated on every render (as inline arrow functions are), SWR
 * clears and restarts the setTimeout on every render — so the timer never
 * reaches 60 s and polling never fires. useCallback with [initialData.status]
 * keeps the reference stable for the lifetime of the market page.
 */
export function useMarketData(marketId: string, initialData: MarketData) {
  const refreshInterval = useCallback(
    (latestData: MarketData | undefined) => {
      const status = latestData?.status ?? initialData.status;
      return status === "halted" || status === "resolving" ? 10_000 : 60_000;
    },
    // initialData.status is the server-rendered snapshot; it is stable for the
    // lifetime of the page. The function correctly reads latestData (provided
    // by SWR at call time) to adapt the interval when the status changes live.
    [initialData.status]
  );

  return useSWR<MarketData>(
    `/api/markets/${marketId}`,
    marketFetcher,
    {
      refreshInterval,
      fallbackData: initialData,
      revalidateOnMount: true,
      revalidateOnFocus: true,
    }
  );
}
