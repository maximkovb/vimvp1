import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { desc } from "drizzle-orm";
import { verifyCronAuth } from "@/lib/cron-auth";

// GET /api/admin/markets — returns ALL markets including drafts (bearer token required)
export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const rows = await db
    .select({
      id: markets.id,
      title: markets.title,
      status: markets.status,
      outcome: markets.outcome,
      questionType: markets.questionType,
      milestoneThreshold: markets.milestoneThreshold,
      resolvesAt: markets.resolvesAt,
      resolvedAt: markets.resolvedAt,
      createdAt: markets.createdAt,
      videoId: markets.videoId,
    })
    .from(markets)
    .orderBy(desc(markets.createdAt))
    .limit(100);

  return NextResponse.json({
    markets: rows.map((m) => ({
      ...m,
      milestoneThreshold: m.milestoneThreshold.toString(),
    })),
  });
}
