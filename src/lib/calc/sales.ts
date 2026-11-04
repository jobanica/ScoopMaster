import { D, money, sum, type DecimalLike, Decimal } from "../money";

export type SalesLineInput = {
  productId: string;
  quantity: number;
  unitPrice: DecimalLike; // partner-specific configured price
  wastageQty?: number;
  unitCost?: DecimalLike; // theoretical cost per unit (transfer price basis)
};

export type SalesInput = {
  lines: SalesLineInput[];
  discounts?: DecimalLike;
  refunds?: DecimalLike;
  reportedTotal?: DecimalLike | null; // total sales the partner declares; defaults to computed net
  cashSales?: DecimalLike;
  gcashSales?: DecimalLike;
  otherSales?: DecimalLike;
  actualCash?: DecimalLike | null; // cash physically submitted / counted
  tolerance?: DecimalLike; // allowed variance before flagging a discrepancy
};

export type SalesComputation = {
  totalUnits: number;
  wastageUnits: number;
  grossSales: Decimal;
  discounts: Decimal;
  refunds: Decimal;
  netSales: Decimal;
  reportedTotal: Decimal;
  salesVariance: Decimal; // reported - computed
  paymentTotal: Decimal;
  paymentMismatch: Decimal; // paymentTotal - netSales
  expectedCash: Decimal; // net sales less non-cash payments
  actualCash: Decimal;
  cashVariance: Decimal; // + overage / - shortage
  estimatedCogs: Decimal;
  estimatedProfit: Decimal;
  lineTotals: Decimal[];
  hasDiscrepancy: boolean;
  discrepancies: string[];
};

export function computeSales(input: SalesInput): SalesComputation {
  for (const l of input.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 0) throw new Error("Quantities must be whole numbers ≥ 0.");
    if ((l.wastageQty ?? 0) < 0) throw new Error("Wastage cannot be negative.");
    if (D(l.unitPrice).isNegative()) throw new Error("Prices cannot be negative.");
  }
  const lineTotals = input.lines.map((l) => money(D(l.unitPrice).times(l.quantity)));
  const grossSales = money(sum(lineTotals));
  const discounts = money(input.discounts);
  const refunds = money(input.refunds);
  if (discounts.isNegative() || refunds.isNegative()) throw new Error("Discounts and refunds cannot be negative.");
  const netSales = grossSales.minus(discounts).minus(refunds);
  const reportedTotal = input.reportedTotal === null || input.reportedTotal === undefined || input.reportedTotal === "" ? netSales : money(input.reportedTotal);
  const cash = money(input.cashSales);
  const gcash = money(input.gcashSales);
  const other = money(input.otherSales);
  const paymentTotal = cash.plus(gcash).plus(other);
  const expectedCash = netSales.minus(gcash).minus(other);
  const actualCash = input.actualCash === null || input.actualCash === undefined || input.actualCash === "" ? cash : money(input.actualCash);
  const cashVariance = actualCash.minus(expectedCash);
  const salesVariance = reportedTotal.minus(netSales);
  const paymentMismatch = paymentTotal.minus(netSales);
  const estimatedCogs = money(
    sum(input.lines.map((l) => D(l.unitCost).times(l.quantity + (l.wastageQty ?? 0)))),
  );
  const tol = D(input.tolerance ?? 0).abs();
  const discrepancies: string[] = [];
  if (salesVariance.abs().greaterThan(tol))
    discrepancies.push(`Reported total differs from computed sales by ${salesVariance.toFixed(2)}`);
  if (paymentMismatch.abs().greaterThan(tol))
    discrepancies.push(`Payment breakdown differs from net sales by ${paymentMismatch.toFixed(2)}`);
  if (cashVariance.abs().greaterThan(tol))
    discrepancies.push(`Cash ${cashVariance.isNegative() ? "shortage" : "overage"} of ${cashVariance.abs().toFixed(2)}`);
  if (netSales.isNegative()) discrepancies.push("Net sales is negative");

  return {
    totalUnits: input.lines.reduce((a, l) => a + l.quantity, 0),
    wastageUnits: input.lines.reduce((a, l) => a + (l.wastageQty ?? 0), 0),
    grossSales, discounts, refunds, netSales, reportedTotal, salesVariance, paymentTotal, paymentMismatch,
    expectedCash, actualCash, cashVariance, estimatedCogs,
    estimatedProfit: netSales.minus(estimatedCogs),
    lineTotals,
    hasDiscrepancy: discrepancies.length > 0,
    discrepancies,
  };
}
