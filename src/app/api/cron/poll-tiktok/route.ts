import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { pollAllActiveMarkets } from "@/lib/poll-active-markets";

export const maxDuration = 60;

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const force = new URL(request.url).searchParams.get("force") === "true";
  const result = await pollAllActiveMarkets(force);
  return NextResponse.json(result);
}
