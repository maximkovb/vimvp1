/**
 * LMSR (Logarithmic Market Scoring Rule) Automated Market Maker
 *
 * Implements Hanson's LMSR for binary prediction markets.
 * Uses the log-sum-exp trick for numerical stability.
 *
 * Key concepts:
 * - quantities[0] = outstanding YES shares, quantities[1] = outstanding NO shares
 * - b = liquidity parameter (higher = more liquidity, less price sensitivity)
 * - Max market maker loss per binary market = b * ln(2) ≈ 0.693 * b
 * - Prices always sum to 1.0 across outcomes (implied probabilities)
 */

/**
 * Numerically stable log-sum-exp computation.
 * Subtracts the max value before exponentiating to prevent overflow.
 */
function logSumExp(values: number[]): number {
  const max = Math.max(...values);
  if (!isFinite(max)) return -Infinity;
  let sum = 0;
  for (const v of values) {
    sum += Math.exp(v - max);
  }
  return max + Math.log(sum);
}

/**
 * LMSR cost function: C(q) = b * ln(sum(e^(q_i/b)))
 * Returns the total cost state of the market.
 */
export function cost(quantities: number[], b: number): number {
  const exponents = quantities.map((q) => q / b);
  return b * logSumExp(exponents);
}

/**
 * Current price (implied probability) for a specific outcome.
 * This is the marginal cost of an infinitesimal share — equivalent to softmax.
 */
export function price(quantities: number[], b: number, outcome: number): number {
  const exponents = quantities.map((q) => q / b);
  const max = Math.max(...exponents);
  const expVals = exponents.map((e) => Math.exp(e - max));
  const sum = expVals.reduce((a, c) => a + c, 0);
  return expVals[outcome] / sum;
}

/**
 * Returns prices for all outcomes.
 */
export function allPrices(quantities: number[], b: number): number[] {
  return quantities.map((_, i) => price(quantities, b, i));
}

/**
 * Cost to buy (positive numShares) or sell (negative numShares) shares of a specific outcome.
 * Returns the amount the user must pay (positive) or receive (negative).
 */
export function tradeCost(
  quantities: number[],
  b: number,
  outcome: number,
  numShares: number
): number {
  const before = cost(quantities, b);
  const newQuantities = [...quantities];
  newQuantities[outcome] += numShares;
  const after = cost(newQuantities, b);
  return after - before;
}

/**
 * Given a currency amount to spend, calculate how many shares the user gets.
 * Uses binary search since the LMSR cost function is monotonically increasing.
 *
 * @param quantities Current market quantities [qYes, qNo]
 * @param b Liquidity parameter
 * @param outcome Which outcome to buy (0=YES, 1=NO for binary)
 * @param amount Currency amount the user wants to spend (must be positive)
 * @returns Number of shares the user receives
 */
export function sharesForCost(
  quantities: number[],
  b: number,
  outcome: number,
  amount: number
): number {
  if (amount <= 0) return 0;

  // Binary search for the number of shares that costs `amount`
  // Upper bound: at most `amount / price` shares (if price never moved)
  const currentPrice = price(quantities, b, outcome);
  let lo = 0;
  let hi = amount / Math.max(currentPrice, 0.001) * 2; // generous upper bound

  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const midCost = tradeCost(quantities, b, outcome, mid);

    if (Math.abs(midCost - amount) < 0.000001) {
      return mid;
    }

    if (midCost < amount) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return lo; // Return conservative estimate (slightly fewer shares)
}

/**
 * Calculate the maximum loss the market maker can incur for a binary market.
 * This is the "subsidy" required to fund the market.
 */
export function maxMarketMakerLoss(b: number): number {
  return b * Math.LN2;
}
