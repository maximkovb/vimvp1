import { users, coinTransactions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import type { db } from "@/db";
import type { CoinTransactionType } from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class InsufficientBalanceError extends Error {
  constructor(public readonly balance: number, public readonly required: number) {
    super(`Insufficient balance: have ${balance}, need ${required}`);
    this.name = "InsufficientBalanceError";
  }
}

export type LedgerRefs = {
  /** For 'trade' type: the tradeId (also set as referenceId for the unique index) */
  referenceId?: string;
  /** FK to trades.id — only for 'trade' type */
  tradeId?: string;
};

export type LedgerResult = {
  balanceBefore: number;
  balanceAfter: number;
};

/**
 * Debit (subtract) `amount` from the user's balance inside an existing transaction.
 * Acquires a row-level lock via SELECT FOR UPDATE before modifying balance.
 * Throws InsufficientBalanceError if balance < amount.
 * Uses RETURNING to capture balance_after atomically — no second SELECT.
 */
export async function debitBalance(
  tx: Tx,
  userId: string,
  amount: number,
  type: CoinTransactionType,
  refs: LedgerRefs = {}
): Promise<LedgerResult> {
  // 1. Lock the user row
  const [user] = await tx
    .select({ balance: users.balance })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");

  if (!user) throw new Error(`User ${userId} not found`);

  const balanceBefore = parseFloat(user.balance);
  if (balanceBefore < amount) {
    throw new InsufficientBalanceError(balanceBefore, amount);
  }

  // 2. Deduct — RETURNING captures the committed balance_after atomically
  const [updated] = await tx
    .update(users)
    .set({ balance: sql`${users.balance} - ${amount.toFixed(2)}` })
    .where(eq(users.id, userId))
    .returning({ balance: users.balance });

  const balanceAfter = parseFloat(updated.balance);

  // 3. Insert ledger entry with snapshots
  await tx.insert(coinTransactions).values({
    userId,
    amount: (-amount).toFixed(2),
    balanceBefore: balanceBefore.toFixed(2),
    balanceAfter: balanceAfter.toFixed(2),
    type,
    referenceId: refs.referenceId,
    tradeId: refs.tradeId,
  });

  return { balanceBefore, balanceAfter };
}

/**
 * Credit (add) `amount` to the user's balance inside an existing transaction.
 * Acquires a row-level lock via SELECT FOR UPDATE to produce a consistent snapshot.
 * Uses RETURNING to capture balance_after atomically.
 */
export async function creditBalance(
  tx: Tx,
  userId: string,
  amount: number,
  type: CoinTransactionType,
  refs: LedgerRefs = {}
): Promise<LedgerResult> {
  // 1. Lock the user row to produce a consistent balance_before snapshot
  const [user] = await tx
    .select({ balance: users.balance })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");

  if (!user) throw new Error(`User ${userId} not found`);

  const balanceBefore = parseFloat(user.balance);

  // 2. Credit — RETURNING captures the committed balance_after atomically
  const [updated] = await tx
    .update(users)
    .set({ balance: sql`${users.balance} + ${amount.toFixed(2)}` })
    .where(eq(users.id, userId))
    .returning({ balance: users.balance });

  const balanceAfter = parseFloat(updated.balance);

  // 3. Insert ledger entry with snapshots
  await tx.insert(coinTransactions).values({
    userId,
    amount: amount.toFixed(2),
    balanceBefore: balanceBefore.toFixed(2),
    balanceAfter: balanceAfter.toFixed(2),
    type,
    referenceId: refs.referenceId,
    tradeId: refs.tradeId,
  });

  return { balanceBefore, balanceAfter };
}
