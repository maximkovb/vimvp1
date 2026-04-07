import { NextResponse } from "next/server";
import { z } from "zod";
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
import { verifyCronAuth } from "@/lib/cron-auth";
import { price, tradeCost, sharesForCost, allPrices } from "@/lib/lmsr";

// AGENT_USER_ID must be set to the ID of a pre-created agent user in the DB.
// Create the user once via a DB migration or seed script, then set this env var.
// Without it, all trade requests return 501.

class ConcurrentTradeError extends Error {
  constructor() {
    super("Concurrent trade detected, please retry");
    this.name = "ConcurrentTradeError";
  }
}

const TradeSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("buy"),
    marketId: z.string().min(1),
    outcome: z.union([z.literal(0), z.literal(1)]),
    amount: z.number().min(1, "Minimum trade is 1 coin"),
  }),
  z.object({
    action: z.literal("sell"),
    marketId: z.string().min(1),
    outcome: z.union([z.literal(0), z.literal(1)]),
    shares: z.number().positive().finite(),
  }),
]);

// POST /api/trades — agent trading endpoint
// Auth: Authorization: Bearer <CRON_SECRET>
export async function POST(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const agentUserId = process.env.AGENT_USER_ID;
  if (!agentUserId) {
    return NextResponse.json(
      { error: "Agent user not configured" },
      { status: 501 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = TradeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const data = parsed.data;

  if (data.action === "buy") {
    return handleBuy(agentUserId, data.marketId, data.outcome, data.amount);
  } else {
    return handleSell(agentUserId, data.marketId, data.outcome, data.shares);
  }
}

async function handleBuy(
  userId: string,
  marketId: string,
  outcome: number,
  amount: number
): Promise<NextResponse> {
  let lastError: ConcurrentTradeError | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await db.transaction(async (tx) => {
        // 1. Fetch market and user within transaction
        const [market] = await tx
          .select()
          .from(markets)
          .where(eq(markets.id, marketId))
          .limit(1);

        if (!market) return { _err: "Market not found", _status: 404 };
        if (market.status !== "active")
          return { _err: "Market is not active for trading", _status: 409 };

        const [user] = await tx
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        if (!user) return { _err: "User not found", _status: 404 };

        const userBalance = parseFloat(user.balance);
        if (userBalance < amount)
          return { _err: "Insufficient balance", _status: 402 };

        // 2. Calculate trade
        const quantities = [
          parseFloat(market.quantityYes),
          parseFloat(market.quantityNo),
        ];
        const b = parseFloat(market.bParameter);
        const priceBefore = price(quantities, b, outcome);

        const shares = sharesForCost(quantities, b, outcome, amount);
        if (shares <= 0) return { _err: "Trade too small", _status: 400 };

        const actualCost = tradeCost(quantities, b, outcome, shares);
        if (actualCost > userBalance)
          return { _err: "Insufficient balance", _status: 402 };

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
          .where(
            and(
              eq(users.id, userId),
              sql`${users.balance} >= ${actualCost.toFixed(2)}`
            )
          )
          .returning({ id: users.id });

        if (!updated) return { _err: "Insufficient balance", _status: 402 };

        // Optimistic lock: update market quantities only if version matches
        const [marketUpdated] = await tx
          .update(markets)
          .set({
            quantityYes: newQuantities[0].toFixed(6),
            quantityNo: newQuantities[1].toFixed(6),
            version: sql`${markets.version} + 1`,
          })
          .where(
            and(eq(markets.id, marketId), eq(markets.version, market.version))
          )
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
          volumeTotal: sql`COALESCE((SELECT volume_total FROM price_snapshots WHERE market_id = ${marketId} ORDER BY recorded_at DESC LIMIT 1), 0) + ${actualCost.toFixed(2)}`,
        });

        return { success: true, shares, cost: actualCost };
      });

      if ("_err" in result) {
        return NextResponse.json(
          { error: result._err },
          { status: result._status }
        );
      }
      return NextResponse.json(result, { status: 200 });
    } catch (e) {
      if (e instanceof ConcurrentTradeError) {
        lastError = e;
        continue;
      }
      throw e;
    }
  }

  void lastError;
  return NextResponse.json(
    { error: "Price changed during trade, please try again" },
    { status: 409 }
  );
}

async function handleSell(
  userId: string,
  marketId: string,
  outcome: number,
  sharesToSell: number
): Promise<NextResponse> {
  let lastError: ConcurrentTradeError | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await db.transaction(async (tx) => {
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

        if (!position) return { _err: "No position to sell", _status: 409 };

        const currentShares = parseFloat(position.shares);
        if (sharesToSell > currentShares) {
          return {
            _err: `You only have ${currentShares.toFixed(2)} shares`,
            _status: 400,
          };
        }

        // Fetch market
        const [market] = await tx
          .select()
          .from(markets)
          .where(eq(markets.id, marketId))
          .limit(1);

        if (!market) return { _err: "Market not found", _status: 404 };
        if (market.status !== "active")
          return { _err: "Market is not active for trading", _status: 409 };

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
          .where(
            and(eq(markets.id, marketId), eq(markets.version, market.version))
          )
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
          volumeTotal: sql`COALESCE((SELECT volume_total FROM price_snapshots WHERE market_id = ${marketId} ORDER BY recorded_at DESC LIMIT 1), 0) + ${refund.toFixed(2)}`,
        });

        return { success: true, refund };
      });

      if ("_err" in result) {
        return NextResponse.json(
          { error: result._err },
          { status: result._status }
        );
      }
      return NextResponse.json(result, { status: 200 });
    } catch (e) {
      if (e instanceof ConcurrentTradeError) {
        lastError = e;
        continue;
      }
      throw e;
    }
  }

  void lastError;
  return NextResponse.json(
    { error: "Price changed during trade, please try again" },
    { status: 409 }
  );
}
