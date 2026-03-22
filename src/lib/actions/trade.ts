"use server";

class ConcurrentTradeError extends Error {
  constructor() {
    super("Concurrent trade detected, please retry");
    this.name = "ConcurrentTradeError";
  }
}

import { db } from "@/db";
import {
  markets,
  users,
  positions,
  trades,
  coinTransactions,
  priceSnapshots,
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { price, tradeCost, sharesForCost, allPrices } from "@/lib/lmsr";

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
  if (amount <= 0) return { error: "Amount must be positive" };
  if (outcome !== 0 && outcome !== 1) return { error: "Invalid outcome" };

  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, marketId))
    .limit(1);

  if (!market) return { error: "Market not found" };
  if (market.status !== "active") return { error: "Market is not active" };

  const quantities = [
    parseFloat(market.quantityYes),
    parseFloat(market.quantityNo),
  ];
  const b = parseFloat(market.bParameter);

  const currentPrice = price(quantities, b, outcome);
  const shares = sharesForCost(quantities, b, outcome, amount);
  const cost = tradeCost(quantities, b, outcome, shares);

  // Calculate new price after trade
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
      return await db.transaction(async (tx) => {
        // 1. Fetch market and user within transaction
        const [market] = await tx
          .select()
          .from(markets)
          .where(eq(markets.id, marketId))
          .limit(1);

        if (!market) return { error: "Market not found" };
        if (market.status !== "active") return { error: "Market is not active for trading" };

        const [user] = await tx
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        if (!user) return { error: "User not found" };

        const userBalance = parseFloat(user.balance);
        if (userBalance < amount) return { error: "Insufficient balance" };

        // 2. Calculate trade
        const quantities = [
          parseFloat(market.quantityYes),
          parseFloat(market.quantityNo),
        ];
        const b = parseFloat(market.bParameter);
        const priceBefore = price(quantities, b, outcome);

        const shares = sharesForCost(quantities, b, outcome, amount);
        if (shares <= 0) return { error: "Trade too small" };

        const actualCost = tradeCost(quantities, b, outcome, shares);
        if (actualCost > userBalance) return { error: "Insufficient balance" };

        // New quantities after trade
        const newQuantities = [...quantities];
        newQuantities[outcome] += shares;
        const priceAfter = price(newQuantities, b, outcome);

        // 3. Execute trade — all writes within transaction
        const tradeId = crypto.randomUUID();

        // Atomic balance deduction with guard
        const [updated] = await tx
          .update(users)
          .set({
            balance: sql`${users.balance} - ${actualCost.toFixed(2)}`,
          })
          .where(and(eq(users.id, userId), sql`${users.balance} >= ${actualCost.toFixed(2)}`))
          .returning({ id: users.id });

        if (!updated) return { error: "Insufficient balance" };

        // Optimistic lock: update market quantities only if version matches
        const [marketUpdated] = await tx
          .update(markets)
          .set({
            quantityYes: newQuantities[0].toFixed(6),
            quantityNo: newQuantities[1].toFixed(6),
            version: sql`${markets.version} + 1`,
          })
          .where(and(eq(markets.id, marketId), eq(markets.version, market.version)))
          .returning({ id: markets.id });

        if (!marketUpdated) {
          throw new ConcurrentTradeError();
        }

        // Insert trade record
        await tx.insert(trades).values({
          id: tradeId,
          userId,
          marketId,
          outcome,
          shares: shares.toFixed(6),
          cost: actualCost.toFixed(6),
          priceBefore: priceBefore.toFixed(6),
          priceAfter: priceAfter.toFixed(6),
        });

        // Upsert position
        const [existingPosition] = await tx
          .select()
          .from(positions)
          .where(
            and(
              eq(positions.userId, userId),
              eq(positions.marketId, marketId),
              eq(positions.outcome, outcome)
            )
          )
          .limit(1);

        if (existingPosition) {
          const existingShares = parseFloat(existingPosition.shares);
          const existingCostBasis = parseFloat(existingPosition.avgCostBasis);
          const totalShares = existingShares + shares;
          const newAvgCost =
            (existingCostBasis * existingShares + actualCost) / totalShares;

          await tx
            .update(positions)
            .set({
              shares: totalShares.toFixed(6),
              avgCostBasis: newAvgCost.toFixed(6),
            })
            .where(eq(positions.id, existingPosition.id));
        } else {
          await tx.insert(positions).values({
            userId,
            marketId,
            outcome,
            shares: shares.toFixed(6),
            avgCostBasis: (actualCost / shares).toFixed(6),
          });
        }

        // Log coin transaction
        await tx.insert(coinTransactions).values({
          userId,
          amount: (-actualCost).toFixed(2),
          type: "trade",
          referenceId: tradeId,
        });

        // Record price snapshot
        const allP = allPrices(newQuantities, b);
        await tx.insert(priceSnapshots).values({
          marketId,
          priceYes: allP[0].toFixed(6),
          priceNo: allP[1].toFixed(6),
        });

        return { success: true, shares, cost: actualCost };
      });
    } catch (e) {
      if (e instanceof ConcurrentTradeError) {
        lastError = e;
        continue; // retry
      }
      throw e; // non-concurrent errors bubble up immediately
    }
  }
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
  if (sharesToSell <= 0) return { error: "Must sell a positive number of shares" };
  if (outcome !== 0 && outcome !== 1) return { error: "Invalid outcome" };

  const userId = session.user.id;

  let lastError: ConcurrentTradeError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        // Check position
        const [position] = await tx
          .select()
          .from(positions)
          .where(
            and(
              eq(positions.userId, userId),
              eq(positions.marketId, marketId),
              eq(positions.outcome, outcome)
            )
          )
          .limit(1);

        if (!position) return { error: "No position to sell" };

        const currentShares = parseFloat(position.shares);
        if (sharesToSell > currentShares) {
          return { error: `You only have ${currentShares.toFixed(2)} shares` };
        }

        // Fetch market
        const [market] = await tx
          .select()
          .from(markets)
          .where(eq(markets.id, marketId))
          .limit(1);

        if (!market) return { error: "Market not found" };
        if (market.status !== "active") return { error: "Market is not active for trading" };

        const quantities = [
          parseFloat(market.quantityYes),
          parseFloat(market.quantityNo),
        ];
        const b = parseFloat(market.bParameter);
        const priceBefore = price(quantities, b, outcome);

        // Selling = negative shares in tradeCost (returns negative = refund)
        const refund = -tradeCost(quantities, b, outcome, -sharesToSell);

        const newQuantities = [...quantities];
        newQuantities[outcome] -= sharesToSell;
        const priceAfter = price(newQuantities, b, outcome);

        const tradeId = crypto.randomUUID();

        // Optimistic lock: update market quantities only if version matches
        const [marketUpdated] = await tx
          .update(markets)
          .set({
            quantityYes: newQuantities[0].toFixed(6),
            quantityNo: newQuantities[1].toFixed(6),
            version: sql`${markets.version} + 1`,
          })
          .where(and(eq(markets.id, marketId), eq(markets.version, market.version)))
          .returning({ id: markets.id });

        if (!marketUpdated) {
          throw new ConcurrentTradeError();
        }

        // Credit user balance
        await tx
          .update(users)
          .set({
            balance: sql`${users.balance} + ${refund.toFixed(2)}`,
          })
          .where(eq(users.id, userId));

        // Insert trade (negative shares = sell)
        await tx.insert(trades).values({
          id: tradeId,
          userId,
          marketId,
          outcome,
          shares: (-sharesToSell).toFixed(6),
          cost: (-refund).toFixed(6),
          priceBefore: priceBefore.toFixed(6),
          priceAfter: priceAfter.toFixed(6),
        });

        // Update position
        const remainingShares = currentShares - sharesToSell;
        if (remainingShares <= 0.000001) {
          await tx
            .update(positions)
            .set({ shares: "0" })
            .where(eq(positions.id, position.id));
        } else {
          await tx
            .update(positions)
            .set({ shares: remainingShares.toFixed(6) })
            .where(eq(positions.id, position.id));
        }

        // Log coin transaction
        await tx.insert(coinTransactions).values({
          userId,
          amount: refund.toFixed(2),
          type: "trade",
          referenceId: tradeId,
        });

        // Record price snapshot
        const allP = allPrices(newQuantities, b);
        await tx.insert(priceSnapshots).values({
          marketId,
          priceYes: allP[0].toFixed(6),
          priceNo: allP[1].toFixed(6),
        });

        return { success: true, refund };
      });
    } catch (e) {
      if (e instanceof ConcurrentTradeError) {
        lastError = e;
        continue; // retry
      }
      throw e; // non-concurrent errors bubble up immediately
    }
  }
  return { error: "Price changed during trade, please try again" };
}
