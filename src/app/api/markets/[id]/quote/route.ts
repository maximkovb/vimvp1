import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { price, sharesForCost, tradeCost } from "@/lib/lmsr";

// GET /api/markets/[id]/quote — read-only price quote (no auth required)
// Query params: ?outcome=0&amount=100
//   outcome: 0 (YES) or 1 (NO)
//   amount:  positive number of coins to spend
// Returns: { shares, cost, avgPrice, priceImpact, currentPrice, newPrice }
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { searchParams } = new URL(request.url);
  const outcomeRaw = searchParams.get("outcome");
  const amountRaw = searchParams.get("amount");

  if (outcomeRaw === null || amountRaw === null) {
    return NextResponse.json(
      { error: "Both 'outcome' and 'amount' query parameters are required" },
      { status: 400 }
    );
  }

  const outcome = Number(outcomeRaw);
  if (outcome !== 0 && outcome !== 1) {
    return NextResponse.json(
      { error: "outcome must be 0 (YES) or 1 (NO)" },
      { status: 400 }
    );
  }

  const amount = Number(amountRaw);
  if (!isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive number" },
      { status: 400 }
    );
  }

  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, id))
    .limit(1);

  if (!market) {
    return NextResponse.json({ error: "Market not found" }, { status: 404 });
  }

  if (market.status !== "active") {
    return NextResponse.json(
      { error: "Market is not active" },
      { status: 409 }
    );
  }

  const quantities = [
    parseFloat(market.quantityYes),
    parseFloat(market.quantityNo),
  ];
  const b = parseFloat(market.bParameter);

  const currentPrice = price(quantities, b, outcome);
  const shares = sharesForCost(quantities, b, outcome, amount);
  const cost = tradeCost(quantities, b, outcome, shares);

  const newQuantities = [...quantities];
  newQuantities[outcome] += shares;
  const newPrice = price(newQuantities, b, outcome);

  return NextResponse.json({
    shares,
    cost,
    avgPrice: shares > 0 ? cost / shares : 0,
    priceImpact: newPrice - currentPrice,
    currentPrice,
    newPrice,
  });
}
