import type { MarketData } from "@/types/market";

/**
 * Shared SWR fetcher for /api/markets/[id].
 * Must be a stable function reference — if defined inline in each component,
 * SWR treats them as separate cache keys and fires duplicate requests.
 */
export async function marketFetcher(url: string): Promise<MarketData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch market data: ${res.status}`);
  return res.json();
}
