"use server";

import { db } from "@/db";
import { users, coinTransactions, markets } from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
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

    // Check if already claimed today
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

    // Calculate reward
    const streakBonus = Math.min(
      (newStreak - 1) * STREAK_BONUS_PER_DAY,
      MAX_STREAK_BONUS
    );
    const totalReward = BASE_DAILY_REWARD + streakBonus;

    // Atomic balance update + streak info
    await tx
      .update(users)
      .set({
        balance: sql`${users.balance} + ${totalReward.toFixed(2)}`,
        loginStreak: newStreak,
        lastLoginReward: now,
      })
      .where(eq(users.id, userId));

    // Log daily reward (single entry for total)
    await tx.insert(coinTransactions).values({
      userId,
      amount: totalReward.toFixed(2),
      type: "daily_login",
      referenceId: todayUTC.toISOString().slice(0, 10),
    });

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
    const [user] = await db
      .select({
        loginStreak: users.loginStreak,
        lastLoginReward: users.lastLoginReward,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return { error: "User not found" };

    const recentTransactions = await db
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
      .limit(5);

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
