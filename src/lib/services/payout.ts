import { positions, coinTransactions } from "@/db/schema";
import { eq, and, ne, sql } from "drizzle-orm";
import type { db } from "@/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Distribute payouts to winning positions for a resolved market.
 * Must be called within a transaction.
 * Idempotent: skips users who already have a payout coinTransaction for this market.
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

  const payoutValues = toPay.map((p) => ({
    userId: p.userId,
    payout: parseFloat(p.shares).toFixed(2),
  }));

  // Bulk UPDATE users balance and capture balance_before/after using RETURNING
  const updated = await tx.execute<{ id: string; balance_before: string; balance_after: string }>(sql`
    UPDATE users u
    SET balance = (u.balance::numeric + v.payout)::numeric
    FROM (VALUES ${sql.join(
      payoutValues.map((p) => sql`(${p.userId}::text, ${p.payout}::numeric)`),
      sql`, `
    )}) AS v(user_id, payout)
    WHERE u.id = v.user_id
    RETURNING u.id,
      (u.balance - v.payout)::numeric AS balance_before,
      u.balance::numeric AS balance_after
  `);

  // Build a lookup from userId → snapshots
  const snapshots = new Map(
    updated.rows.map((r) => [r.id, { before: r.balance_before, after: r.balance_after }])
  );

  // Bulk INSERT coin transactions with balance snapshots
  await tx.execute(sql`
    INSERT INTO coin_transactions (id, user_id, amount, balance_before, balance_after, type, reference_id, created_at)
    VALUES ${sql.join(
      payoutValues.map((p) => {
        const snap = snapshots.get(p.userId);
        return sql`(
          gen_random_uuid(),
          ${p.userId},
          ${p.payout}::numeric,
          ${snap?.before ?? "0"}::numeric,
          ${snap?.after ?? p.payout}::numeric,
          'payout',
          ${marketId},
          NOW()
        )`;
      }),
      sql`, `
    )}
  `);
}

/**
 * Refund all positions in a cancelled market at cost basis.
 * Must be called within a transaction.
 * Idempotent: skips users who already have a refund coinTransaction for this market.
 */
export async function refundPositions(tx: Tx, marketId: string) {
  const allPos = await tx
    .select()
    .from(positions)
    .where(and(eq(positions.marketId, marketId), ne(positions.shares, "0")));

  // Idempotency check: skip users already refunded (mirrors distributePayout pattern)
  const existingRefunds = await tx
    .select({ userId: coinTransactions.userId })
    .from(coinTransactions)
    .where(
      and(
        eq(coinTransactions.referenceId, marketId),
        eq(coinTransactions.type, "refund")
      )
    );
  const alreadyRefunded = new Set(existingRefunds.map((e) => e.userId));

  const toRefund = allPos
    .filter((p) => !alreadyRefunded.has(p.userId))
    .map((p) => ({
      id: p.id,
      userId: p.userId,
      refundAmount: (parseFloat(p.shares) * parseFloat(p.avgCostBasis)).toFixed(2),
    }))
    .filter((p) => parseFloat(p.refundAmount) > 0);

  if (toRefund.length === 0) return;

  // Bulk UPDATE users balance and capture balance_before/after using RETURNING
  const updated = await tx.execute<{ id: string; balance_before: string; balance_after: string }>(sql`
    UPDATE users u
    SET balance = (u.balance::numeric + v.refund)::numeric
    FROM (VALUES ${sql.join(
      toRefund.map((p) => sql`(${p.userId}::text, ${p.refundAmount}::numeric)`),
      sql`, `
    )}) AS v(user_id, refund)
    WHERE u.id = v.user_id
    RETURNING u.id,
      (u.balance - v.refund)::numeric AS balance_before,
      u.balance::numeric AS balance_after
  `);

  const snapshots = new Map(
    updated.rows.map((r) => [r.id, { before: r.balance_before, after: r.balance_after }])
  );

  // Bulk INSERT coin transactions with balance snapshots
  await tx.execute(sql`
    INSERT INTO coin_transactions (id, user_id, amount, balance_before, balance_after, type, reference_id, created_at)
    VALUES ${sql.join(
      toRefund.map((p) => {
        const snap = snapshots.get(p.userId);
        return sql`(
          gen_random_uuid(),
          ${p.userId},
          ${p.refundAmount}::numeric,
          ${snap?.before ?? "0"}::numeric,
          ${snap?.after ?? p.refundAmount}::numeric,
          'refund',
          ${marketId},
          NOW()
        )`;
      }),
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
