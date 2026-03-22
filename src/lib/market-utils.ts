import { allPrices } from "@/lib/lmsr";

export function getMarketPrices(market: {
  quantityYes: string;
  quantityNo: string;
  bParameter: string;
}) {
  const quantities = [
    parseFloat(market.quantityYes),
    parseFloat(market.quantityNo),
  ];
  const b = parseFloat(market.bParameter);
  return allPrices(quantities, b);
}
