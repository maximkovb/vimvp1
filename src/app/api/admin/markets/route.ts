import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { desc } from "drizzle-orm";
import { verifyCronAuth } from "@/lib/cron-auth";

/**
 * GET /api/admin/markets
 *
 * Returns all markets in all statuses (including drafts).
 * Bearer-token authenticated — agent-accessible.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 *
 * Response: { markets: Array<{ id, title, status, videoId, questionType,
 *             milestoneThreshold, createdAt, resolvesAt, resolvedAt }> }
 */
export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const rows = await db
    .select({
      id: markets.id,
      title: markets.title,
      status: markets.status,
      videoId: markets.videoId,
      questionType: markets.questionType,
      milestoneThreshold: markets.milestoneThreshold,
      createdAt: markets.createdAt,
      resolvesAt: markets.resolvesAt,
      resolvedAt: markets.resolvedAt,
    })
    .from(markets)
    .orderBy(desc(markets.createdAt))
    .limit(200);

  return NextResponse.json({
    markets: rows.map((m) => ({
      ...m,
      milestoneThreshold: m.milestoneThreshold.toString(),
    })),
  });
}
