import { D, money, qty, type DecimalLike, Decimal } from "../money";

/**
 * INVENTORY_COUNT reporting: the partner counts stock at closing; everything else is derived.
 *
 *   used            = expected on hand (ledger: last count + deliveries) − closing count
 *   units sold      = containers used (cones, cups) − containers wasted (broken / spilled)
 *   sales           = Σ units sold × partner price of the product mapped to that container
 *   cost of goods   = Σ used × unit value   (uncounted items: estimated from units sold via recipes)
 *   gross profit    = sales − cost of goods
 *   powder check    = actual powder used vs. powder needed for the units sold (flags unreported sales)
 */
export type CountItem = {
  itemId: string;
  name: string;
  expected: DecimalLike; // system on hand at closing
  closing: DecimalLike | null; // null = not counted
  wasted?: DecimalLike;
  unitValue: DecimalLike; // cost per unit (contract basis)
  isContainer: boolean; // cones / cups drive units sold
};

export type CountDriver = { containerItemId: string; productId: string; price: DecimalLike };
export type ProductConsumption = Map<string, Map<string, Decimal>>; // productId → itemId → qty per unit

export type CountResult = {
  lines: { productId: string; quantity: number; unitPrice: Decimal; lineTotal: Decimal }[];
  items: { itemId: string; name: string; counted: boolean; expected: Decimal; closing: Decimal; used: Decimal; wasted: Decimal; consumed: Decimal; value: Decimal }[];
  grossSales: Decimal;
  cogs: Decimal;
  checks: { itemId: string; name: string; expectedUse: Decimal; actualUse: Decimal; variancePct: Decimal | null; flagged: boolean }[];
  totalUnits: number;
};

export function computeCountReport(items: CountItem[], drivers: CountDriver[], consumption: ProductConsumption, opts: { tolerancePct: DecimalLike }): CountResult {
  const byItem = new Map(items.map((i) => [i.itemId, i]));
  const qtyByProduct = new Map<string, number>();
  const priceByProduct = new Map<string, Decimal>();
  const out: CountResult["items"] = [];

  // 1. Containers → units sold
  for (const d of drivers) {
    const it = byItem.get(d.containerItemId);
    if (!it) continue;
    if (it.closing === null || it.closing === undefined || it.closing === "") throw new Error(`Please count ${it.name} — it is needed to calculate sales.`);
    const expected = D(it.expected), closing = D(it.closing), wasted = D(it.wasted ?? 0);
    if (closing.isNegative() || wasted.isNegative()) throw new Error(`${it.name}: counts cannot be negative.`);
    const used = expected.minus(closing);
    if (used.isNegative()) throw new Error(`${it.name}: you counted ${closing} but only ${expected} should be on hand. If you received supplies that are not in the system, please contact Scoop Master.`);
    if (wasted.gt(used)) throw new Error(`${it.name}: wasted (${wasted}) cannot be more than used (${used}).`);
    const sold = used.minus(wasted);
    if (!sold.isInteger() || !closing.isInteger() || !wasted.isInteger()) throw new Error(`${it.name} must be counted in whole pieces.`);
    qtyByProduct.set(d.productId, (qtyByProduct.get(d.productId) ?? 0) + sold.toNumber());
    priceByProduct.set(d.productId, D(d.price));
  }

  const lines = [...qtyByProduct.entries()].map(([productId, quantity]) => {
    const unitPrice = money(priceByProduct.get(productId)!);
    return { productId, quantity, unitPrice, lineTotal: money(unitPrice.times(quantity)) };
  });
  const theoretical = (itemId: string) => lines.reduce((a, l) => a.plus((consumption.get(l.productId)?.get(itemId) ?? new Decimal(0)).times(l.quantity)), new Decimal(0));

  // 2. Every item: actual usage when counted, estimated usage when not
  const checks: CountResult["checks"] = [];
  for (const it of items) {
    const expected = D(it.expected);
    const counted = !(it.closing === null || it.closing === undefined || it.closing === "");
    let used: Decimal, wasted: Decimal, closing: Decimal;
    if (counted) {
      closing = D(it.closing);
      wasted = D(it.wasted ?? 0);
      if (closing.isNegative() || wasted.isNegative()) throw new Error(`${it.name}: counts cannot be negative.`);
      used = qty(expected.minus(closing));
      if (used.isNegative()) throw new Error(`${it.name}: counted ${closing} is more than the ${expected} expected on hand. Please recount or contact Scoop Master.`);
      if (wasted.gt(used)) throw new Error(`${it.name}: wasted cannot be more than used.`);
      if (!it.isContainer) {
        const need = qty(theoretical(it.itemId));
        if (need.gt(0) || used.gt(0)) {
          const variancePct = need.gt(0) ? used.minus(need).dividedBy(need).times(100) : null;
          checks.push({ itemId: it.itemId, name: it.name, expectedUse: need, actualUse: used, variancePct, flagged: variancePct === null ? used.gt(0) : variancePct.gt(D(opts.tolerancePct)) });
        }
      }
    } else {
      used = qty(theoretical(it.itemId));
      wasted = new Decimal(0);
      closing = expected.minus(used);
    }
    if (used.isZero() && !counted) continue;
    out.push({ itemId: it.itemId, name: it.name, counted, expected, closing, used, wasted, consumed: used.minus(wasted), value: money(used.times(D(it.unitValue))) });
  }

  const grossSales = money(lines.reduce((a, l) => a.plus(l.lineTotal), new Decimal(0)));
  const cogs = money(out.reduce((a, i) => a.plus(i.value), new Decimal(0)));
  return { lines, items: out, grossSales, cogs, checks, totalUnits: lines.reduce((a, l) => a + l.quantity, 0) };
}
