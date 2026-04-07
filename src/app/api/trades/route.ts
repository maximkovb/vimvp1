import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import {
  ConcurrentTradeError,
  executeBuy,
  executeSell,
} from "@/lib/services/trade-executor";

// AGENT_USER_ID must be set to the ID of a pre-created agent user in the DB.
// Create the user once via a DB migration or seed script, then set this env var.
// Without it, all trade requests return 501.

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
    return NextResponse.json({ error: "Agent user not configured" }, { status: 501 });
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
  let lastError: ConcurrentTradeError | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result =
        data.action === "buy"
          ? await db.transaction((tx) =>
              executeBuy(tx, agentUserId, data.marketId, data.outcome, data.amount)
            )
          : await db.transaction((tx) =>
              executeSell(tx, agentUserId, data.marketId, data.outcome, data.shares)
            );

      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
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
