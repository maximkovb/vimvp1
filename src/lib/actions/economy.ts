"use server";

import { db } from "@/db";
import { users, markets, coinTransactions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { creditBalance } from "@/lib/services/ledger";
import type { CoinTransactionType } from "@/db/schema";

const BASE_DAILY_REWARD = 50;
const STREAK_BONUS_PER_DAY = 10;
const MAX_STREAK_BONUS = 100; // cap at 10-day streak bonus

export type ClaimResult =
  | { success: true; reward: number; streak: number; streakBonus: number }
  | { error: string; alreadyClaimed?: boolean };

export async function claimDailyReward(): Promise<ClaimResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Not authenticated" };
  }

  const userId = session.user.id;

  const result = await db.transaction(async (tx) => {
    // Lock the user row for the entire transaction (date check + balance update must be atomic)
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");

    if (!user) return { error: "User not found" } as const;

    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const lastRewardUTC = user.lastLoginReward
      ? new Date(Date.UTC(
          user.lastLoginReward.getUTCFullYear(),
          user.lastLoginReward.getUTCMonth(),
          user.lastLoginReward.getUTCDate()
        ))
      : null;

    if (lastRewardUTC && lastRewardUTC.getTime() === todayUTC.getTime()) {
      return { error: "Already claimed today", alreadyClaimed: true } as const;
    }

    // Calculate streak
    let newStreak = 1;
    if (lastRewardUTC) {
      const yesterday = new Date(todayUTC);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      if (lastRewardUTC.getTime() === yesterday.getTime()) {
        newStreak = user.loginStreak + 1;
      }
    }

    const streakBonus = Math.min((newStreak - 1) * STREAK_BONUS_PER_DAY, MAX_STREAK_BONUS);
    const totalReward = BASE_DAILY_REWARD + streakBonus;
    const referenceId = todayUTC.toISOString().slice(0, 10); // UTC date string — must stay UTC (idempotency key)

    // Credit balance with ledger snapshot (creditBalance's FOR UPDATE is a no-op — row already locked above)
    await creditBalance(tx, userId, totalReward, "daily_login", { referenceId });

    // Update streak + lastLoginReward separately (creditBalance only touches balance)
    await tx
      .update(users)
      .set({ loginStreak: newStreak, lastLoginReward: now })
      .where(eq(users.id, userId));

    return {
      success: true as const,
      reward: totalReward,
      streak: newStreak,
      streakBonus,
    };
  });

  if ("success" in result) {
    revalidatePath("/");
    revalidatePath("/portfolio");
  }

  return result;
}

export type RecentActivityResult =
  | {
      transactions: Array<{
        id: string;
        amount: number;
        type: CoinTransactionType;
        marketTitle: string | null;
        createdAt: Date;
      }>;
      loginStreak: number;
      lastLoginReward: Date | null;
    }
  | { error: string };

export async function getRecentActivity(): Promise<RecentActivityResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Not authenticated" };
  }

  const userId = session.user.id;

  try {
    const [userRows, recentTransactions] = await Promise.all([
      db
        .select({
          loginStreak: users.loginStreak,
          lastLoginReward: users.lastLoginReward,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
      db
        .select({
          id: coinTransactions.id,
          amount: coinTransactions.amount,
          type: coinTransactions.type,
          referenceId: coinTransactions.referenceId,
          createdAt: coinTransactions.createdAt,
          marketTitle: markets.title,
        })
        .from(coinTransactions)
        .leftJoin(markets, eq(coinTransactions.referenceId, markets.id))
        .where(eq(coinTransactions.userId, userId))
        .orderBy(desc(coinTransactions.createdAt))
        .limit(5),
    ]);

    const [user] = userRows;

    if (!user) return { error: "User not found" };

    return {
      transactions: recentTransactions.map((t) => ({
        id: t.id,
        amount: parseFloat(t.amount),
        type: t.type,
        marketTitle: t.marketTitle ?? null,
        createdAt: t.createdAt,
      })),
      loginStreak: user.loginStreak,
      lastLoginReward: user.lastLoginReward,
    };
  } catch {
    return { error: "Failed to load activity" };
  }
}
