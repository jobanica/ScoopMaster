import { D, qty, type DecimalLike, Decimal } from "../money";

/** Moving weighted-average cost after receiving `inQty` at `inCost`. */
export function weightedAverageCost(onHand: DecimalLike, currentAvg: DecimalLike, inQty: DecimalLike, inCost: DecimalLike): Decimal {
  const oh = D(onHand);
  const iq = D(inQty);
  if (iq.lte(0)) return D(currentAvg);
  if (oh.lte(0)) return qty(inCost);
  return qty(oh.times(D(currentAvg)).plus(iq.times(D(inCost))).dividedBy(oh.plus(iq)));
}

export function markup(cost: DecimalLike, price: DecimalLike) {
  const c = D(cost);
  const p = D(price);
  return { amount: p.minus(c), pct: c.gt(0) ? p.minus(c).dividedBy(c).times(100) : new Decimal(0) };
}
