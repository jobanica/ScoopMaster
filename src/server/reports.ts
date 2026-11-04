import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D, money, Decimal } from "@/lib/money";
import { addDays, fmtDate, manilaDayStart, monthLabel, startOfMonth, todayDate, ymd } from "@/lib/dates";
import { balanceOf } from "@/lib/calc/payments";
import type { Permission } from "@/lib/rbac";
import { UOM_LABEL } from "@/lib/units";
import { machineProfitability } from "./services/machines";
import { inventoryValuation } from "./services/inventory";
import { cashFlow, profitAndLoss } from "./services/accounting";

export type ColType = "text" | "date" | "money" | "qty" | "int" | "pct";
export type Column = { key: string; label: string; type: ColType; total?: boolean };
export type Cell = string | number | Decimal | Date | null;
export type ReportResult = { columns: Column[]; rows: Record<string, Cell>[]; notes?: string[] };
export type ReportParams = { from: Date; to: Date; partnerId?: string };
export type ReportDef = { key: string; title: string; group: string; description: string; permission: Permission; usesRange: boolean; usesPartner: boolean; run: (p: ReportParams) => Promise<ReportResult> };

const salesWhere = (p: ReportParams): Prisma.SalesReportWhereInput => ({ status: { in: ["SUBMITTED", "APPROVED"] }, reportDate: { gte: p.from, lte: p.to }, ...(p.partnerId ? { partnerId: p.partnerId } : {}) });
const salesCols: Column[] = [
  { key: "reports", label: "Reports", type: "int", total: true }, { key: "units", label: "Units", type: "int", total: true },
  { key: "gross", label: "Gross sales", type: "money", total: true }, { key: "discounts", label: "Discounts", type: "money", total: true }, { key: "refunds", label: "Refunds", type: "money", total: true },
  { key: "net", label: "Net sales", type: "money", total: true }, { key: "cash", label: "Cash", type: "money", total: true }, { key: "gcash", label: "GCash", type: "money", total: true }, { key: "other", label: "Other", type: "money", total: true },
  { key: "cashVariance", label: "Cash variance", type: "money", total: true }, { key: "profit", label: "Est. gross profit", type: "money", total: true },
];

async function salesBy(p: ReportParams, bucket: (d: Date) => { key: string; label: string; sort: string }) {
  const reports = await prisma.salesReport.findMany({ where: salesWhere(p), select: { reportDate: true, totalUnits: true, grossSales: true, discounts: true, refunds: true, netSales: true, cashSales: true, gcashSales: true, otherSales: true, cashVariance: true, estimatedProfit: true } });
  const map = new Map<string, Record<string, Cell> & { _sort: string }>();
  for (const r of reports) {
    const b = bucket(r.reportDate);
    const row = map.get(b.key) ?? { _sort: b.sort, period: b.label, reports: 0, units: 0, gross: new Decimal(0), discounts: new Decimal(0), refunds: new Decimal(0), net: new Decimal(0), cash: new Decimal(0), gcash: new Decimal(0), other: new Decimal(0), cashVariance: new Decimal(0), profit: new Decimal(0) };
    row.reports = (row.reports as number) + 1;
    row.units = (row.units as number) + r.totalUnits;
    for (const [k, v] of [["gross", r.grossSales], ["discounts", r.discounts], ["refunds", r.refunds], ["net", r.netSales], ["cash", r.cashSales], ["gcash", r.gcashSales], ["other", r.otherSales], ["cashVariance", r.cashVariance], ["profit", r.estimatedProfit]] as const) row[k] = D(row[k] as Decimal).plus(D(v));
    map.set(b.key, row);
  }
  return [...map.values()].sort((a, b) => a._sort.localeCompare(b._sort)).map(({ _sort: _s, ...r }) => r);
}

function isoWeekStart(d: Date) {
  const day = (d.getUTCDay() + 6) % 7;
  return addDays(d, -day);
}

async function partnerNames(ids: (string | null)[]) {
  const ps = await prisma.partner.findMany({ where: { id: { in: ids.filter(Boolean) as string[] } }, select: { id: true, businessName: true, code: true, area: true } });
  return new Map(ps.map((p) => [p.id, p]));
}

export const REPORTS: ReportDef[] = [
  {
    key: "daily-sales", title: "Daily sales", group: "Sales", description: "Sales per day with payment breakdown and cash variances.", permission: "reports:view", usesRange: true, usesPartner: true,
    run: async (p) => ({ columns: [{ key: "period", label: "Date", type: "text" }, ...salesCols], rows: await salesBy(p, (d) => ({ key: ymd(d), label: fmtDate(d), sort: ymd(d) })) }),
  },
  {
    key: "weekly-sales", title: "Weekly sales", group: "Sales", description: "Sales per ISO week (Monday start).", permission: "reports:view", usesRange: true, usesPartner: true,
    run: async (p) => ({ columns: [{ key: "period", label: "Week of", type: "text" }, ...salesCols], rows: await salesBy(p, (d) => { const w = isoWeekStart(d); return { key: ymd(w), label: `${fmtDate(w)} – ${fmtDate(addDays(w, 6))}`, sort: ymd(w) }; }) }),
  },
  {
    key: "monthly-sales", title: "Monthly sales", group: "Sales", description: "Sales per calendar month.", permission: "reports:view", usesRange: true, usesPartner: true,
    run: async (p) => ({ columns: [{ key: "period", label: "Month", type: "text" }, ...salesCols], rows: await salesBy(p, (d) => { const m = startOfMonth(d); return { key: ymd(m), label: monthLabel(m), sort: ymd(m) }; }) }),
  },
  {
    key: "sales-by-partner", title: "Sales per partner", group: "Sales", description: "Totals per partner location, including discrepancies.", permission: "reports:view", usesRange: true, usesPartner: false,
    run: async (p) => {
      const g = await prisma.salesReport.groupBy({ by: ["partnerId"], where: salesWhere(p), _sum: { totalUnits: true, grossSales: true, netSales: true, cashVariance: true, estimatedProfit: true }, _count: true });
      const disc = await prisma.salesReport.groupBy({ by: ["partnerId"], where: { ...salesWhere(p), hasDiscrepancy: true }, _count: true });
      const names = await partnerNames(g.map((x) => x.partnerId));
      return {
        columns: [{ key: "code", label: "ID", type: "text" }, { key: "partner", label: "Partner", type: "text" }, { key: "area", label: "Area", type: "text" }, { key: "reports", label: "Reports", type: "int", total: true }, { key: "discrepancies", label: "With discrepancy", type: "int", total: true }, { key: "units", label: "Units", type: "int", total: true }, { key: "gross", label: "Gross", type: "money", total: true }, { key: "net", label: "Net sales", type: "money", total: true }, { key: "avg", label: "Avg / report", type: "money" }, { key: "cashVariance", label: "Cash variance", type: "money", total: true }, { key: "profit", label: "Est. gross profit", type: "money", total: true }],
        rows: g.map((x) => ({ code: names.get(x.partnerId)?.code ?? "", partner: names.get(x.partnerId)?.businessName ?? "", area: names.get(x.partnerId)?.area ?? "", reports: x._count, discrepancies: disc.find((d) => d.partnerId === x.partnerId)?._count ?? 0, units: x._sum.totalUnits ?? 0, gross: D(x._sum.grossSales), net: D(x._sum.netSales), avg: money(D(x._sum.netSales).dividedBy(x._count || 1)), cashVariance: D(x._sum.cashVariance), profit: D(x._sum.estimatedProfit) })).sort((a, b) => b.net.comparedTo(a.net)),
      };
    },
  },
  {
    key: "sales-by-machine", title: "Sales per machine", group: "Sales", description: "Totals per machine.", permission: "reports:view", usesRange: true, usesPartner: true,
    run: async (p) => {
      const g = await prisma.salesReport.groupBy({ by: ["machineId"], where: salesWhere(p), _sum: { totalUnits: true, netSales: true, estimatedProfit: true }, _count: true });
      const ms = await prisma.machine.findMany({ where: { id: { in: g.map((x) => x.machineId).filter(Boolean) as string[] } } });
      return {
        columns: [{ key: "machine", label: "Machine", type: "text" }, { key: "model", label: "Brand / model", type: "text" }, { key: "reports", label: "Reports", type: "int", total: true }, { key: "units", label: "Units", type: "int", total: true }, { key: "net", label: "Net sales", type: "money", total: true }, { key: "profit", label: "Est. gross profit", type: "money", total: true }],
        rows: g.map((x) => { const m = ms.find((y) => y.id === x.machineId); return { machine: m?.code ?? "(none)", model: m ? `${m.brand} ${m.model}` : "", reports: x._count, units: x._sum.totalUnits ?? 0, net: D(x._sum.netSales), profit: D(x._sum.estimatedProfit) }; }),
      };
    },
  },
  {
    key: "product-performance", title: "Product performance", group: "Sales", description: "Units, revenue, wastage and theoretical margin per product.", permission: "reports:view", usesRange: true, usesPartner: true,
    run: async (p) => {
      const lines = await prisma.salesReportLine.findMany({ where: { report: salesWhere(p) }, include: { product: true } });
      const map = new Map<string, Record<string, Cell>>();
      for (const l of lines) {
        const r = map.get(l.productId) ?? { product: l.product.name, code: l.product.code, units: 0, wastage: 0, revenue: new Decimal(0), cost: new Decimal(0) };
        r.units = (r.units as number) + l.quantity;
        r.wastage = (r.wastage as number) + l.wastageQty;
        r.revenue = D(r.revenue as Decimal).plus(D(l.lineTotal));
        r.cost = D(r.cost as Decimal).plus(D(l.unitCost).times(l.quantity + l.wastageQty));
        map.set(l.productId, r);
      }
      const rows = [...map.values()].map((r) => ({ ...r, cost: money(r.cost as Decimal), margin: D(r.revenue as Decimal).minus(D(r.cost as Decimal)), avgPrice: (r.units as number) ? money(D(r.revenue as Decimal).dividedBy(r.units as number)) : new Decimal(0), wastePct: (r.units as number) + (r.wastage as number) ? new Decimal(r.wastage as number).dividedBy((r.units as number) + (r.wastage as number)).times(100) : new Decimal(0) }));
      return { columns: [{ key: "code", label: "Code", type: "text" }, { key: "product", label: "Product", type: "text" }, { key: "units", label: "Units sold", type: "int", total: true }, { key: "wastage", label: "Wasted", type: "int", total: true }, { key: "wastePct", label: "Waste %", type: "pct" }, { key: "avgPrice", label: "Avg price", type: "money" }, { key: "revenue", label: "Revenue", type: "money", total: true }, { key: "cost", label: "Theoretical cost", type: "money", total: true }, { key: "margin", label: "Gross margin", type: "money", total: true }], rows };
    },
  },
  {
    key: "inventory-movement", title: "Inventory movement", group: "Inventory", description: "Movement totals by item, location and type.", permission: "reports:view", usesRange: true, usesPartner: true,
    run: async (p) => {
      const loc = p.partnerId ? await prisma.location.findUnique({ where: { partnerId: p.partnerId } }) : null;
      const g = await prisma.stockMovement.groupBy({ by: ["itemId", "locationId", "type"], where: { occurredAt: { gte: manilaDayStart(p.from), lt: manilaDayStart(addDays(p.to, 1)) }, ...(loc ? { locationId: loc.id } : {}) }, _sum: { quantity: true }, _count: true });
      const [items, locs] = await Promise.all([prisma.inventoryItem.findMany(), prisma.location.findMany()]);
      return {
        columns: [{ key: "item", label: "Item", type: "text" }, { key: "uom", label: "UoM", type: "text" }, { key: "location", label: "Location", type: "text" }, { key: "type", label: "Movement", type: "text" }, { key: "count", label: "Entries", type: "int", total: true }, { key: "qty", label: "Net quantity", type: "qty" }],
        rows: g.map((x) => { const it = items.find((i) => i.id === x.itemId)!; return { item: it.name, uom: UOM_LABEL[it.uom], location: locs.find((l) => l.id === x.locationId)?.name ?? "", type: x.type.replace(/_/g, " ").toLowerCase(), count: x._count, qty: D(x._sum.quantity) }; }).sort((a, b) => `${a.item}${a.location}`.localeCompare(`${b.item}${b.location}`)),
      };
    },
  },
  {
    key: "inventory-valuation", title: "Inventory valuation", group: "Inventory", description: "Current stock at cost and at partner price, by location.", permission: "reports:view", usesRange: false, usesPartner: true,
    run: async (p) => {
      const loc = p.partnerId ? await prisma.location.findUnique({ where: { partnerId: p.partnerId } }) : null;
      const rows = await inventoryValuation(loc?.id);
      return { columns: [{ key: "sku", label: "SKU", type: "text" }, { key: "name", label: "Item", type: "text" }, { key: "location", label: "Location", type: "text" }, { key: "quantity", label: "On hand", type: "qty" }, { key: "uom", label: "UoM", type: "text" }, { key: "avgCost", label: "Avg cost", type: "money" }, { key: "costValue", label: "Value at cost", type: "money", total: true }, { key: "priceValue", label: "Value at partner price", type: "money", total: true }], rows: rows.map((r) => ({ ...r, uom: UOM_LABEL[r.uom], costValue: money(r.costValue), priceValue: money(r.priceValue) })) };
    },
  },
  {
    key: "supply-sales", title: "Supply sales", group: "Supply", description: "Supply invoices issued to partners.", permission: "reports:financial", usesRange: true, usesPartner: true,
    run: async (p) => {
      const inv = await prisma.invoice.findMany({ where: { type: "SUPPLY", status: { not: "CANCELLED" }, issueDate: { gte: p.from, lte: p.to }, ...(p.partnerId ? { partnerId: p.partnerId } : {}) }, include: { partner: true }, orderBy: { issueDate: "asc" } });
      return { columns: [{ key: "date", label: "Date", type: "date" }, { key: "number", label: "Invoice", type: "text" }, { key: "partner", label: "Partner", type: "text" }, { key: "amount", label: "Amount", type: "money", total: true }, { key: "cost", label: "My cost", type: "money", total: true }, { key: "markup", label: "Markup", type: "money", total: true }, { key: "paid", label: "Paid", type: "money", total: true }, { key: "balance", label: "Balance", type: "money", total: true }],
        rows: inv.map((i) => ({ date: i.issueDate, number: i.number, partner: i.partner?.businessName ?? "", amount: D(i.amount), cost: D(i.costAmount), markup: D(i.amount).minus(D(i.costAmount)), paid: D(i.amountPaid), balance: balanceOf(i) })) };
    },
  },
  {
    key: "supply-markup", title: "Supply markup income", group: "Supply", description: "My markup on supplies by item — reported separately from profit sharing.", permission: "reports:financial", usesRange: true, usesPartner: true,
    run: async (p) => {
      const lines = await prisma.invoiceLine.findMany({ where: { invoice: { type: "SUPPLY", status: { not: "CANCELLED" }, issueDate: { gte: p.from, lte: p.to }, ...(p.partnerId ? { partnerId: p.partnerId } : {}) } }, include: { item: true } });
      const map = new Map<string, Record<string, Cell>>();
      for (const l of lines) {
        const k = l.itemId ?? l.description;
        const r = map.get(k) ?? { item: l.item?.name ?? l.description, uom: l.item ? UOM_LABEL[l.item.uom] : "", qty: new Decimal(0), revenue: new Decimal(0), cost: new Decimal(0) };
        r.qty = D(r.qty as Decimal).plus(D(l.quantity)); r.revenue = D(r.revenue as Decimal).plus(D(l.lineTotal)); r.cost = D(r.cost as Decimal).plus(D(l.lineCost));
        map.set(k, r);
      }
      const rows = [...map.values()].map((r) => ({ ...r, markup: D(r.revenue as Decimal).minus(D(r.cost as Decimal)), pct: D(r.cost as Decimal).gt(0) ? D(r.revenue as Decimal).minus(D(r.cost as Decimal)).dividedBy(D(r.cost as Decimal)).times(100) : new Decimal(0) }));
      return { columns: [{ key: "item", label: "Item", type: "text" }, { key: "qty", label: "Qty sold", type: "qty" }, { key: "uom", label: "UoM", type: "text" }, { key: "revenue", label: "Sales to partners", type: "money", total: true }, { key: "cost", label: "My cost", type: "money", total: true }, { key: "markup", label: "Markup income", type: "money", total: true }, { key: "pct", label: "Markup %", type: "pct" }], rows, notes: ["Markup income is earned when supplies are delivered and invoiced. It is never part of a partnership profit split."] };
    },
  },
  {
    key: "partnership-profit", title: "Partnership profit", group: "Profit sharing", description: "Finalized settlements: sales, supplies, expenses, distributable profit.", permission: "reports:financial", usesRange: true, usesPartner: true,
    run: async (p) => {
      const s = await prisma.settlement.findMany({ where: { status: "FINALIZED", periodEnd: { gte: p.from, lte: p.to }, ...(p.partnerId ? { partnerId: p.partnerId } : {}) }, include: { partner: true }, orderBy: { periodEnd: "asc" } });
      return { columns: [{ key: "number", label: "Settlement", type: "text" }, { key: "partner", label: "Partner", type: "text" }, { key: "period", label: "Period", type: "text" }, { key: "net", label: "Net sales", type: "money", total: true }, { key: "supplies", label: "Supplies consumed", type: "money", total: true }, { key: "opex", label: "Operating expenses", type: "money", total: true }, { key: "dist", label: "Distributable", type: "money", total: true }, { key: "owner", label: "Owner share", type: "money", total: true }, { key: "partnerShare", label: "Partner share", type: "money", total: true }],
        rows: s.map((x) => ({ number: x.number, partner: x.partner.businessName, period: `${fmtDate(x.periodStart)} – ${fmtDate(x.periodEnd)}`, net: D(x.netSales), supplies: D(x.suppliesConsumed), opex: D(x.operatingExpenses), dist: D(x.distributableProfit), owner: D(x.ownerShare), partnerShare: D(x.partnerShare) })) };
    },
  },
  {
    key: "partner-shares", title: "Partner profit shares", group: "Profit sharing", description: "Earnings per partner from finalized settlements, and amounts settled.", permission: "reports:financial", usesRange: true, usesPartner: false,
    run: async (p) => {
      const s = await prisma.settlement.findMany({ where: { status: "FINALIZED", periodEnd: { gte: p.from, lte: p.to } }, include: { partner: true, invoice: true, bill: true } });
      const map = new Map<string, Record<string, Cell>>();
      for (const x of s) {
        const r = map.get(x.partnerId) ?? { partner: x.partner.businessName, settlements: 0, owner: new Decimal(0), partnerShare: new Decimal(0), due: new Decimal(0), outstanding: new Decimal(0) };
        r.settlements = (r.settlements as number) + 1;
        r.owner = D(r.owner as Decimal).plus(D(x.ownerShare)); r.partnerShare = D(r.partnerShare as Decimal).plus(D(x.partnerShare)); r.due = D(r.due as Decimal).plus(D(x.netDueToOwner));
        r.outstanding = D(r.outstanding as Decimal).plus(x.invoice ? balanceOf(x.invoice) : new Decimal(0)).minus(x.bill ? balanceOf(x.bill) : new Decimal(0));
        map.set(x.partnerId, r);
      }
      return { columns: [{ key: "partner", label: "Partner", type: "text" }, { key: "settlements", label: "Settlements", type: "int", total: true }, { key: "owner", label: "Owner share", type: "money", total: true }, { key: "partnerShare", label: "Partner share", type: "money", total: true }, { key: "due", label: "Net due to owner", type: "money", total: true }, { key: "outstanding", label: "Still outstanding (+ owed to me / − I owe)", type: "money", total: true }], rows: [...map.values()] };
    },
  },
  {
    key: "expenses", title: "Expenses", group: "Finance", description: "Owner expenses (bills) by category and payee.", permission: "reports:financial", usesRange: true, usesPartner: false,
    run: async (p) => {
      const bills = await prisma.bill.findMany({ where: { status: { not: "CANCELLED" }, billDate: { gte: p.from, lte: p.to }, category: { not: "PARTNER_PAYOUT" } }, orderBy: { billDate: "asc" } });
      return { columns: [{ key: "date", label: "Date", type: "date" }, { key: "number", label: "Bill", type: "text" }, { key: "category", label: "Category", type: "text" }, { key: "payee", label: "Payee", type: "text" }, { key: "description", label: "Description", type: "text" }, { key: "amount", label: "Amount", type: "money", total: true }, { key: "balance", label: "Unpaid", type: "money", total: true }],
        rows: bills.map((b) => ({ date: b.billDate, number: b.number, category: b.category.replace(/_/g, " ").toLowerCase(), payee: b.payeeName, description: b.description, amount: D(b.amount), balance: balanceOf(b) })), notes: ["Machine purchases are capital items and are excluded from the profit & loss report."] };
    },
  },
  {
    key: "accounts-payable", title: "Accounts payable (aging)", group: "Finance", description: "Open bills with aging buckets as of today.", permission: "reports:financial", usesRange: false, usesPartner: false,
    run: async () => {
      const today = todayDate();
      const bills = await prisma.bill.findMany({ where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } }, orderBy: { dueDate: "asc" } });
      return { columns: agingCols("Payee"), rows: bills.map((b) => agingRow(b.number, b.payeeName, b.dueDate, balanceOf(b), today)) };
    },
  },
  {
    key: "accounts-receivable", title: "Accounts receivable (aging)", group: "Finance", description: "Open invoices with aging buckets as of today.", permission: "reports:financial", usesRange: false, usesPartner: true,
    run: async (p) => {
      const today = todayDate();
      const inv = await prisma.invoice.findMany({ where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] }, ...(p.partnerId ? { partnerId: p.partnerId } : {}) }, include: { partner: true, contact: true }, orderBy: { dueDate: "asc" } });
      return { columns: agingCols("Owed by"), rows: inv.map((i) => agingRow(`${i.number} (${i.type.replace(/_/g, " ").toLowerCase()})`, i.partner?.businessName ?? i.contact?.name ?? "", i.dueDate, balanceOf(i), today)) };
    },
  },
  {
    key: "cash-flow", title: "Cash flow", group: "Finance", description: "Confirmed payments in and out (cash basis).", permission: "reports:financial", usesRange: true, usesPartner: false,
    run: async (p) => {
      const cf = await cashFlow(p.from, p.to);
      const map = new Map<string, { date: Date; in: Decimal; out: Decimal }>();
      for (const x of cf.payments) {
        const k = ymd(x.paymentDate);
        const r = map.get(k) ?? { date: x.paymentDate, in: new Decimal(0), out: new Decimal(0) };
        if (x.direction === "IN") r.in = r.in.plus(D(x.amount)); else r.out = r.out.plus(D(x.amount));
        map.set(k, r);
      }
      let running = new Decimal(0);
      const rows = [...map.values()].sort((a, b) => a.date.getTime() - b.date.getTime()).map((r) => { running = running.plus(r.in).minus(r.out); return { date: r.date, inflow: r.in, outflow: r.out, net: r.in.minus(r.out), running }; });
      return { columns: [{ key: "date", label: "Date", type: "date" }, { key: "inflow", label: "Cash in", type: "money", total: true }, { key: "outflow", label: "Cash out", type: "money", total: true }, { key: "net", label: "Net", type: "money", total: true }, { key: "running", label: "Cumulative", type: "money" }], rows,
        notes: [...cf.byMethod.entries()].map(([m, v]) => `${m.replace("_", " ")}: in ${v.in.toFixed(2)}, out ${v.out.toFixed(2)}`) };
    },
  },
  {
    key: "profit-and-loss", title: "Profit and loss", group: "Finance", description: "Owner P&L (accrual): partnership income, supply markup, other income, expenses.", permission: "reports:financial", usesRange: true, usesPartner: false,
    run: async (p) => {
      const pl = await profitAndLoss(p.from, p.to);
      const rows: Record<string, Cell>[] = [
        { line: "Partnership income (owner share of finalized settlements)", amount: pl.partnershipIncome },
        { line: "Supply sales to partners", amount: pl.supplySales },
        { line: "Machine sales", amount: pl.machineSales }, { line: "Machine rentals", amount: pl.machineRentals }, { line: "Installment income", amount: pl.installments }, { line: "Other income", amount: pl.otherIncome },
        { line: "TOTAL REVENUE", amount: pl.revenue },
        { line: "Cost of supplies / goods sold", amount: pl.costOfSales.negated() },
        { line: "GROSS PROFIT", amount: pl.grossProfit },
        ...pl.expenses.map((e) => ({ line: `Expense: ${e.category.replace(/_/g, " ").toLowerCase()}`, amount: e.amount.negated() })),
        { line: "TOTAL OPERATING EXPENSES", amount: pl.totalExpenses.negated() },
        { line: "NET INCOME", amount: pl.netIncome },
        { line: "Memo: supply markup income (included above)", amount: pl.supplyMarkup },
      ];
      return { columns: [{ key: "line", label: "Line", type: "text" }, { key: "amount", label: "Amount", type: "money" }], rows, notes: ["Partnership-share invoices are collection documents for settlement amounts and are not counted as revenue a second time.", "Partner sales are not owner revenue; only the owner's contractual share is."] };
    },
  },
  {
    key: "machine-maintenance", title: "Machine maintenance", group: "Machines", description: "Maintenance and repair records with costs.", permission: "reports:view", usesRange: true, usesPartner: false,
    run: async (p) => {
      const recs = await prisma.maintenanceRecord.findMany({ where: { reportedAt: { gte: manilaDayStart(p.from), lt: manilaDayStart(addDays(p.to, 1)) } }, include: { machine: true, partner: true, technician: true }, orderBy: { reportedAt: "asc" } });
      return { columns: [{ key: "date", label: "Reported", type: "date" }, { key: "number", label: "No.", type: "text" }, { key: "machine", label: "Machine", type: "text" }, { key: "partner", label: "Partner", type: "text" }, { key: "type", label: "Type", type: "text" }, { key: "status", label: "Status", type: "text" }, { key: "description", label: "Description", type: "text" }, { key: "technician", label: "Technician", type: "text" }, { key: "cost", label: "Cost", type: "money", total: true }],
        rows: recs.map((r) => ({ date: new Date(ymd(new Date(r.reportedAt.getTime() + 8 * 3600000))), number: r.number, machine: r.machine.code, partner: r.partner?.businessName ?? "", type: r.type.replace(/_/g, " ").toLowerCase(), status: r.status.toLowerCase(), description: r.description, technician: r.technician?.name ?? "", cost: D(r.cost) })) };
    },
  },
  {
    key: "machine-roi", title: "Machine ROI", group: "Machines", description: "Lifetime sales, attributed owner income, maintenance and ROI per machine.", permission: "reports:financial", usesRange: false, usesPartner: false,
    run: async () => {
      const rows = await machineProfitability();
      return { columns: [{ key: "code", label: "Machine", type: "text" }, { key: "status", label: "Status", type: "text" }, { key: "price", label: "Purchase price", type: "money", total: true }, { key: "sales", label: "Total sales", type: "money", total: true }, { key: "supplies", label: "Supplies consumed", type: "money", total: true }, { key: "income", label: "Owner income", type: "money", total: true }, { key: "maintenance", label: "Maintenance", type: "money", total: true }, { key: "profit", label: "Net profit", type: "money", total: true }, { key: "roi", label: "ROI", type: "pct" }, { key: "utilization", label: "Utilization", type: "pct" }],
        rows: rows.map((r) => ({ code: r.machine.code, status: r.machine.status.toLowerCase(), price: D(r.machine.purchasePrice), sales: r.totalSales, supplies: r.suppliesConsumed, income: r.partnershipIncome, maintenance: r.maintenanceCost, profit: r.netProfit, roi: r.roiPct, utilization: new Decimal(r.utilizationPct) })),
        notes: ["Owner income per machine is attributed from finalized settlements in proportion to each machine's share of the partner's net sales."] };
    },
  },
];

function agingCols(partyLabel: string): Column[] {
  return [{ key: "doc", label: "Document", type: "text" }, { key: "party", label: partyLabel, type: "text" }, { key: "due", label: "Due date", type: "date" }, { key: "days", label: "Days overdue", type: "int" }, { key: "current", label: "Current", type: "money", total: true }, { key: "d30", label: "1–30", type: "money", total: true }, { key: "d60", label: "31–60", type: "money", total: true }, { key: "d90", label: "61–90", type: "money", total: true }, { key: "over", label: "90+", type: "money", total: true }, { key: "total", label: "Balance", type: "money", total: true }];
}
function agingRow(doc: string, party: string, due: Date, bal: Decimal, today: Date): Record<string, Cell> {
  const days = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000));
  const z = new Decimal(0);
  return { doc, party, due, days, current: days === 0 ? bal : z, d30: days >= 1 && days <= 30 ? bal : z, d60: days > 30 && days <= 60 ? bal : z, d90: days > 60 && days <= 90 ? bal : z, over: days > 90 ? bal : z, total: bal };
}

export function totalsFor(result: ReportResult): Record<string, Cell> | null {
  const cols = result.columns.filter((c) => c.total);
  if (!cols.length || !result.rows.length) return null;
  const t: Record<string, Cell> = {};
  for (const c of cols) t[c.key] = c.type === "int" ? result.rows.reduce((a, r) => a + Number(r[c.key] ?? 0), 0) : result.rows.reduce((a, r) => a.plus(D((r[c.key] ?? 0) as Decimal)), new Decimal(0));
  return t;
}

export function formatCell(v: Cell, type: ColType, opts: { currency?: "symbol" | "text" | "none" } = {}): string {
  if (v === null || v === undefined || v === "") return "";
  switch (type) {
    case "date": return v instanceof Date ? fmtDate(v) : String(v);
    case "money": {
      const d = money(D(v as Decimal));
      const s = d.abs().toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      const sym = opts.currency === "none" ? "" : opts.currency === "text" ? "PHP " : "₱";
      return `${d.isNegative() ? "-" : ""}${sym}${s}`;
    }
    case "qty": return D(v as Decimal).toDecimalPlaces(4).toString();
    case "pct": return `${D(v as Decimal).toFixed(1)}%`;
    case "int": return String(v);
    default: return String(v);
  }
}

export function getReport(key: string) {
  return REPORTS.find((r) => r.key === key);
}
