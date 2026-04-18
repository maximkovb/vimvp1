import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/balance — returns authenticated user's balance, loginStreak, lastLoginReward
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [user] = await db
    .select({
      balance: users.balance,
      loginStreak: users.loginStreak,
      lastLoginReward: users.lastLoginReward,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      balance: parseFloat(user.balance),
      loginStreak: user.loginStreak,
      lastLoginReward: user.lastLoginReward?.toISOString() ?? null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
