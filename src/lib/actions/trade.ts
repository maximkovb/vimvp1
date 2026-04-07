"use server";

import { db } from "@/db";
import { markets, positions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { price, tradeCost, sharesForCost } from "@/lib/lmsr";
import {
  ConcurrentTradeError,
  executeBuy,
  executeSell,
} from "@/lib/services/trade-executor";

export type UserPosition = {
  outcome: number;
  shares: number;
  avgCostBasis: number;
};

export type TradePreview = {
  shares: number;
  cost: number;
  avgPrice: number;
  priceImpact: number;
  currentPrice: number;
  newPrice: number;
};

/**
 * Preview a trade before executing it.
 * Returns estimated shares, cost, and price impact.
 */
export async function previewTrade(
  marketId: string,
  outcome: number,
  amount: number
): Promise<TradePreview | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated" };
  if (amount <= 0) return { error: "Amount must be positive" };
  if (outcome !== 0 && outcome !== 1) return { error: "Invalid outcome" };

  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, marketId))
    .limit(1);

  if (!market) return { error: "Market not found" };
  if (market.status !== "active") return { error: "Market is not active" };

  const quantities = [parseFloat(market.quantityYes), parseFloat(market.quantityNo)];
  const b = parseFloat(market.bParameter);

  const currentPrice = price(quantities, b, outcome);
  const shares = sharesForCost(quantities, b, outcome, amount);
  const cost = tradeCost(quantities, b, outcome, shares);

  const newQuantities = [...quantities];
  newQuantities[outcome] += shares;
  const newPrice = price(newQuantities, b, outcome);

  return {
    shares,
    cost,
    avgPrice: shares > 0 ? cost / shares : 0,
    priceImpact: newPrice - currentPrice,
    currentPrice,
    newPrice,
  };
}

/**
 * Buy shares in a market.
 * User specifies the currency amount to spend; system calculates shares.
 */
export async function buyShares(
  marketId: string,
  outcome: number,
  amount: number
): Promise<{ success: true; shares: number; cost: number } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated" };
  if (amount < 1) return { error: "Minimum trade is 1 coin" };
  if (outcome !== 0 && outcome !== 1) return { error: "Invalid outcome" };

  const userId = session.user.id;

  let lastError: ConcurrentTradeError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await db.transaction((tx) => executeBuy(tx, userId, marketId, outcome, amount));
      if ("error" in result) return { error: result.error };
      return result;
    } catch (e) {
      if (e instanceof ConcurrentTradeError) {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  void lastError;
  return { error: "Price changed during trade, please try again" };
}

/**
 * Sell shares back to the AMM.
 * User specifies number of shares to sell.
 */
export async function sellShares(
  marketId: string,
  outcome: number,
  sharesToSell: number
): Promise<{ success: true; refund: number } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated" };
  if (!isFinite(sharesToSell) || sharesToSell <= 0)
    return { error: "Must sell a positive number of shares" };
  if (outcome !== 0 && outcome !== 1) return { error: "Invalid outcome" };

  const userId = session.user.id;

  let lastError: ConcurrentTradeError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await db.transaction((tx) =>
        executeSell(tx, userId, marketId, outcome, sharesToSell)
      );
      if ("error" in result) return { error: result.error };
      return result;
    } catch (e) {
      if (e instanceof ConcurrentTradeError) {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  void lastError;
  return { error: "Price changed during trade, please try again" };
}

/**
 * Fetch the authenticated user's position for a given market.
 */
export async function getUserPosition(marketId: string): Promise<UserPosition | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const userId = session.user.id;

  const rows = await db
    .select()
    .from(positions)
    .where(and(eq(positions.userId, userId), eq(positions.marketId, marketId)));

  if (rows.length === 0) return null;

  const active = rows.find((r) => parseFloat(r.shares) > 0.000001);
  if (!active) return null;

  return {
    outcome: active.outcome,
    shares: parseFloat(active.shares),
    avgCostBasis: parseFloat(active.avgCostBasis),
  };
}
