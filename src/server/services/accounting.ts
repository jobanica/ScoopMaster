import { prisma } from "@/lib/db";
import { D, money, Decimal } from "@/lib/money";

/**
 * Owner's profit & loss (accrual basis) — every figure traces to a source document:
 *   Supply sales           = SUPPLY invoices by issue date           (cost of supplies sold = their costAmount)
 *   Partnership income     = owner share of FINALIZED settlements by period end
 *   Machine sales/rentals  = invoices of those types
 *   Operating expenses     = bills by bill date (excluding partner payouts and machine purchases, which are not expenses)
 * PARTNERSHIP_SHARE invoices are collection documents for the settlement amount and are NOT revenue again.
 */
export async function profitAndLoss(from: Date, to: Date) {
  const [invoices, settlements, bills] = await Promise.all([
    prisma.invoice.groupBy({ by: ["type"], where: { status: { not: "CANCELLED" }, issueDate: { gte: from, lte: to }, type: { not: "PARTNERSHIP_SHARE" } }, _sum: { amount: true, costAmount: true } }),
    prisma.settlement.aggregate({ where: { status: "FINALIZED", periodEnd: { gte: from, lte: to } }, _sum: { ownerShare: true } }),
    prisma.bill.groupBy({ by: ["category"], where: { status: { not: "CANCELLED" }, billDate: { gte: from, lte: to }, category: { notIn: ["PARTNER_PAYOUT", "MACHINE_PURCHASE"] } }, _sum: { amount: true } }),
  ]);
  const inv = (t: string) => invoices.find((i) => i.type === t);
  const supplySales = money(inv("SUPPLY")?._sum.amount);
  const supplyCost = money(inv("SUPPLY")?._sum.costAmount);
  const partnershipIncome = money(settlements._sum.ownerShare);
  const machineSales = money(inv("MACHINE_SALE")?._sum.amount);
  const machineRentals = money(inv("MACHINE_RENTAL")?._sum.amount);
  const installments = money(inv("INSTALLMENT")?._sum.amount);
  const otherIncome = money(inv("OTHER")?._sum.amount);
  const otherCost = money(["MACHINE_SALE", "MACHINE_RENTAL", "INSTALLMENT", "OTHER"].reduce((a, t) => a.plus(D(inv(t)?._sum.costAmount)), new Decimal(0)));
  const revenue = supplySales.plus(partnershipIncome).plus(machineSales).plus(machineRentals).plus(installments).plus(otherIncome);
  const costOfSales = supplyCost.plus(otherCost);
  const grossProfit = revenue.minus(costOfSales);
  const expenses = bills.map((b) => ({ category: b.category, amount: money(b._sum.amount) })).sort((a, b) => b.amount.comparedTo(a.amount));
  const totalExpenses = expenses.reduce((a, e) => a.plus(e.amount), new Decimal(0));
  return {
    supplySales, supplyCost, supplyMarkup: supplySales.minus(supplyCost), partnershipIncome, machineSales, machineRentals, installments, otherIncome,
    revenue, costOfSales, grossProfit, expenses, totalExpenses, netIncome: grossProfit.minus(totalExpenses),
  };
}

/** Cash flow from confirmed payments (cash basis). */
export async function cashFlow(from: Date, to: Date) {
  const payments = await prisma.payment.findMany({ where: { status: "CONFIRMED", paymentDate: { gte: from, lte: to } }, orderBy: { paymentDate: "asc" } });
  const byMethod = new Map<string, { in: Decimal; out: Decimal }>();
  let inflow = new Decimal(0), outflow = new Decimal(0);
  for (const p of payments) {
    const m = byMethod.get(p.method) ?? { in: new Decimal(0), out: new Decimal(0) };
    if (p.direction === "IN") { m.in = m.in.plus(D(p.amount)); inflow = inflow.plus(D(p.amount)); } else { m.out = m.out.plus(D(p.amount)); outflow = outflow.plus(D(p.amount)); }
    byMethod.set(p.method, m);
  }
  return { payments, inflow, outflow, net: inflow.minus(outflow), byMethod };
}
