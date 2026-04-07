import { markets, users, positions, trades, priceSnapshots } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { price, tradeCost, sharesForCost, allPrices } from "@/lib/lmsr";
import { debitBalance, creditBalance, InsufficientBalanceError } from "@/lib/services/ledger";
import type { db } from "@/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class ConcurrentTradeError extends Error {
  constructor() {
    super("Concurrent trade detected, please retry");
    this.name = "ConcurrentTradeError";
  }
}

export type BuyResult =
  | { success: true; shares: number; cost: number }
  | { error: string; status?: number };

export type SellResult =
  | { success: true; refund: number }
  | { error: string; status?: number };

/**
 * Execute a buy trade within an existing transaction.
 * - Locks user row via SELECT FOR UPDATE (inside debitBalance)
 * - Uses optimistic locking on market version; throws ConcurrentTradeError on conflict
 * Caller is responsible for the retry loop on ConcurrentTradeError.
 */
export async function executeBuy(
  tx: Tx,
  userId: string,
  marketId: string,
  outcome: number,
  amount: number
): Promise<BuyResult> {
  // 1. Fetch market inside transaction
  const [market] = await tx
    .select()
    .from(markets)
    .where(eq(markets.id, marketId))
    .limit(1);

  if (!market) return { error: "Market not found", status: 404 };
  if (market.status !== "active") return { error: "Market is not active for trading", status: 409 };

  // 2. Quick balance pre-check (non-locking) to return a friendly error before acquiring lock
  const [user] = await tx
    .select({ balance: users.balance })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return { error: "User not found", status: 404 };
  if (parseFloat(user.balance) < amount) return { error: "Insufficient balance", status: 402 };

  // 3. Calculate trade
  const quantities = [parseFloat(market.quantityYes), parseFloat(market.quantityNo)];
  const b = parseFloat(market.bParameter);
  const priceBefore = price(quantities, b, outcome);

  const shares = sharesForCost(quantities, b, outcome, amount);
  if (shares <= 0) return { error: "Trade too small", status: 400 };

  const actualCost = tradeCost(quantities, b, outcome, shares);

  const newQuantities = [...quantities];
  newQuantities[outcome] += shares;
  const priceAfter = price(newQuantities, b, outcome);

  const tradeId = crypto.randomUUID();

  // 4. Debit balance (acquires FOR UPDATE lock on user row, writes ledger entry with snapshots)
  try {
    await debitBalance(tx, userId, actualCost, "trade", {
      referenceId: tradeId,
      tradeId,
    });
  } catch (e) {
    if (e instanceof InsufficientBalanceError) return { error: "Insufficient balance", status: 402 };
    throw e;
  }

  // 5. Optimistic lock on market — throws ConcurrentTradeError if version changed
  const [marketUpdated] = await tx
    .update(markets)
    .set({
      quantityYes: newQuantities[0].toFixed(6),
      quantityNo: newQuantities[1].toFixed(6),
      version: sql`${markets.version} + 1`,
    })
    .where(and(eq(markets.id, marketId), eq(markets.version, market.version)))
    .returning({ id: markets.id });

  if (!marketUpdated) throw new ConcurrentTradeError();

  // 6. Insert trade record
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

  // 7. Upsert position
  const [existingPosition] = await tx
    .select()
    .from(positions)
    .where(and(eq(positions.userId, userId), eq(positions.marketId, marketId), eq(positions.outcome, outcome)))
    .limit(1);

  if (existingPosition) {
    const existingShares = parseFloat(existingPosition.shares);
    const existingCostBasis = parseFloat(existingPosition.avgCostBasis);
    const totalShares = existingShares + shares;
    const newAvgCost = (existingCostBasis * existingShares + actualCost) / totalShares;
    await tx
      .update(positions)
      .set({ shares: totalShares.toFixed(6), avgCostBasis: newAvgCost.toFixed(6) })
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

  // 8. Price snapshot
  const allP = allPrices(newQuantities, b);
  await tx.insert(priceSnapshots).values({
    marketId,
    priceYes: allP[0].toFixed(6),
    priceNo: allP[1].toFixed(6),
    volumeTotal: sql`COALESCE((SELECT volume_total FROM price_snapshots WHERE market_id = ${marketId} ORDER BY recorded_at DESC LIMIT 1), 0) + ${actualCost.toFixed(2)}`,
  });

  return { success: true, shares, cost: actualCost };
}

/**
 * Execute a sell trade within an existing transaction.
 * - Locks position row via SELECT FOR UPDATE to prevent double-sell
 * - Locks user row via SELECT FOR UPDATE (inside creditBalance)
 * - Uses optimistic locking on market version; throws ConcurrentTradeError on conflict
 * Caller is responsible for the retry loop on ConcurrentTradeError.
 */
export async function executeSell(
  tx: Tx,
  userId: string,
  marketId: string,
  outcome: number,
  sharesToSell: number
): Promise<SellResult> {
  // 1. Lock position row to prevent concurrent double-sell
  const [position] = await tx
    .select()
    .from(positions)
    .where(and(eq(positions.userId, userId), eq(positions.marketId, marketId), eq(positions.outcome, outcome)))
    .for("update")
    .limit(1);

  if (!position) return { error: "No position to sell", status: 409 };

  const currentShares = parseFloat(position.shares);
  if (sharesToSell > currentShares) {
    return { error: `You only have ${currentShares.toFixed(2)} shares`, status: 400 };
  }

  // 2. Fetch market
  const [market] = await tx
    .select()
    .from(markets)
    .where(eq(markets.id, marketId))
    .limit(1);

  if (!market) return { error: "Market not found", status: 404 };
  if (market.status !== "active") return { error: "Market is not active for trading", status: 409 };

  const quantities = [parseFloat(market.quantityYes), parseFloat(market.quantityNo)];
  const b = parseFloat(market.bParameter);
  const priceBefore = price(quantities, b, outcome);

  const refund = -tradeCost(quantities, b, outcome, -sharesToSell);
  const newQuantities = [...quantities];
  newQuantities[outcome] -= sharesToSell;
  const priceAfter = price(newQuantities, b, outcome);

  const tradeId = crypto.randomUUID();

  // 3. Optimistic lock on market
  const [marketUpdated] = await tx
    .update(markets)
    .set({
      quantityYes: newQuantities[0].toFixed(6),
      quantityNo: newQuantities[1].toFixed(6),
      version: sql`${markets.version} + 1`,
    })
    .where(and(eq(markets.id, marketId), eq(markets.version, market.version)))
    .returning({ id: markets.id });

  if (!marketUpdated) throw new ConcurrentTradeError();

  // 4. Credit balance (acquires FOR UPDATE lock on user row, writes ledger entry with snapshots)
  await creditBalance(tx, userId, refund, "trade", {
    referenceId: tradeId,
    tradeId,
  });

  // 5. Insert trade record
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

  // 6. Update position
  const remainingShares = currentShares - sharesToSell;
  await tx
    .update(positions)
    .set({ shares: remainingShares <= 0.000001 ? "0" : remainingShares.toFixed(6) })
    .where(eq(positions.id, position.id));

  // 7. Price snapshot
  const allP = allPrices(newQuantities, b);
  await tx.insert(priceSnapshots).values({
    marketId,
    priceYes: allP[0].toFixed(6),
    priceNo: allP[1].toFixed(6),
    volumeTotal: sql`COALESCE((SELECT volume_total FROM price_snapshots WHERE market_id = ${marketId} ORDER BY recorded_at DESC LIMIT 1), 0) + ${refund.toFixed(2)}`,
  });

  return { success: true, refund };
}
