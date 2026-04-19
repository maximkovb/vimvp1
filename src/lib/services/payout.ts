import { positions, users, coinTransactions } from "@/db/schema";
import { eq, and, ne, sql } from "drizzle-orm";
import type { db } from "@/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Distribute payouts to winning positions for a resolved market.
 * Must be called within a transaction.
 */
export async function distributePayout(tx: Tx, marketId: string, outcome: number) {
  const winningPositions = await tx
    .select()
    .from(positions)
    .where(
      and(
        eq(positions.marketId, marketId),
        eq(positions.outcome, outcome),
        ne(positions.shares, "0")
      )
    );

  // Batch idempotency check
  const existingPayouts = await tx
    .select({ userId: coinTransactions.userId })
    .from(coinTransactions)
    .where(
      and(
        eq(coinTransactions.referenceId, marketId),
        eq(coinTransactions.type, "payout")
      )
    );
  const alreadyPaid = new Set(existingPayouts.map((e) => e.userId));

  const toPay = winningPositions.filter((p) => !alreadyPaid.has(p.userId));

  if (toPay.length === 0) return;

  // Pass raw share strings to Postgres and round there — avoids IEEE-754 precision
  // loss from parseFloat() before toFixed(2).
  const payoutValues = toPay.map((p) => ({ userId: p.userId, shares: p.shares }));

  // Bulk UPDATE users balance using a VALUES CTE
  await tx.execute(sql`
    UPDATE users u
    SET balance = (u.balance::numeric + v.payout)::numeric
    FROM (VALUES ${sql.join(
      payoutValues.map((p) => sql`(${p.userId}::text, ROUND(${p.shares}::numeric, 2))`),
      sql`, `
    )}) AS v(user_id, payout)
    WHERE u.id = v.user_id
  `);

  // Bulk INSERT coin transactions (one row per winner)
  await tx.execute(sql`
    INSERT INTO coin_transactions (id, user_id, amount, type, reference_id, created_at)
    VALUES ${sql.join(
      payoutValues.map(
        (p) =>
          sql`(gen_random_uuid(), ${p.userId}, ROUND(${p.shares}::numeric, 2), 'payout', ${marketId}, NOW())`
      ),
      sql`, `
    )}
  `);

  // Zero out winning shares so position state is consistent post-resolution
  // and any future distributePayout call finds nothing to pay via the shares != '0' filter.
  await tx.execute(sql`
    UPDATE positions
    SET shares = '0'
    WHERE market_id = ${marketId}
      AND outcome = ${outcome}
      AND shares != '0'
  `);
}

/**
 * Refund all positions in a cancelled market at cost basis.
 * Must be called within a transaction.
 */
export async function refundPositions(tx: Tx, marketId: string) {
  const allPos = await tx
    .select()
    .from(positions)
    .where(
      and(eq(positions.marketId, marketId), ne(positions.shares, "0"))
    );

  // Only process positions with a positive refund amount
  const toRefund = allPos
    .map((p) => ({
      id: p.id,
      userId: p.userId,
      refundAmount: (parseFloat(p.shares) * parseFloat(p.avgCostBasis)).toFixed(2),
    }))
    .filter((p) => parseFloat(p.refundAmount) > 0);

  if (toRefund.length === 0) return;

  // Bulk UPDATE users balance using a VALUES CTE
  await tx.execute(sql`
    UPDATE users u
    SET balance = (u.balance::numeric + v.refund)::numeric
    FROM (VALUES ${sql.join(
      toRefund.map((p) => sql`(${p.userId}::text, ${p.refundAmount}::numeric)`),
      sql`, `
    )}) AS v(user_id, refund)
    WHERE u.id = v.user_id
  `);

  // Bulk INSERT coin transactions (one row per refunded position)
  await tx.execute(sql`
    INSERT INTO coin_transactions (id, user_id, amount, type, reference_id, created_at)
    VALUES ${sql.join(
      toRefund.map(
        (p) =>
          sql`(gen_random_uuid(), ${p.userId}, ${p.refundAmount}::numeric, 'refund', ${marketId}, NOW())`
      ),
      sql`, `
    )}
  `);

  // Bulk UPDATE positions to zero out shares
  await tx.execute(sql`
    UPDATE positions
    SET shares = '0'
    WHERE id IN (${sql.join(
      toRefund.map((p) => sql`${p.id}`),
      sql`, `
    )})
  `);
}
