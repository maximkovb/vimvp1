export interface BalanceData {
  balance: number;
  loginStreak: number;
  lastLoginReward: string | null;
}

/**
 * Shared SWR fetcher for /api/balance.
 * Must be a stable module-level reference — inline definitions create separate
 * cache keys and fire duplicate requests when multiple components subscribe.
 */
export async function balanceFetcher(url: string): Promise<BalanceData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch balance");
  return res.json();
}
