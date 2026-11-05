import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D, money, Decimal } from "@/lib/money";
import { addDays, endOfMonth, manilaDayStart, monthLabel, startOfMonth, todayDate, ymd, fmtDate } from "@/lib/dates";
import { balanceOf } from "@/lib/calc/payments";
import { lowStockItems } from "./inventory";

export type DashboardFilters = { from: Date; to: Date; partnerId?: string; machineId?: string; area?: string };

function salesWhere(f: DashboardFilters, range: { gte: Date; lte: Date }): Prisma.SalesReportWhereInput {
  return {
    status: { in: ["SUBMITTED", "APPROVED"] },
    reportDate: range,
    ...(f.partnerId ? { partnerId: f.partnerId } : {}),
    ...(f.machineId ? { machineId: f.machineId } : {}),
    ...(f.area ? { partner: { area: { contains: f.area, mode: "insensitive" } } } : {}),
  };
}

const n = (v: unknown) => Number(D(v as never).toFixed(2)); // chart display only

export async function dashboardData(f: DashboardFilters) {
  const today = todayDate();
  const partnerScope: Prisma.PartnerWhereInput = { ...(f.partnerId ? { id: f.partnerId } : {}), ...(f.area ? { area: { contains: f.area, mode: "insensitive" } } : {}) };
  const range = { gte: f.from, lte: f.to };

  const [activePartners, machineGroups, salesToday, salesRange, settlements, supplyInvoices, receivables, payables, levels, lowStock, dailySales, salesByPartner, salesByMachine] = await Promise.all([
    prisma.partner.count({ where: { ...partnerScope, status: "ACTIVE" } }),
    prisma.machine.groupBy({ by: ["status"], where: f.partnerId ? { currentPartnerId: f.partnerId } : f.machineId ? { id: f.machineId } : {}, _count: true }),
    prisma.salesReport.aggregate({ where: salesWhere(f, { gte: today, lte: today }), _sum: { netSales: true } }),
    prisma.salesReport.aggregate({ where: salesWhere(f, range), _sum: { netSales: true, estimatedCogs: true, totalUnits: true }, _count: true }),
    prisma.settlement.aggregate({ where: { status: "FINALIZED", periodEnd: range, partner: partnerScope }, _sum: { ownerShare: true, partnerShare: true } }),
    prisma.invoice.aggregate({ where: { type: "SUPPLY", status: { not: "CANCELLED" }, issueDate: range, partner: partnerScope }, _sum: { amount: true, costAmount: true } }),
    prisma.invoice.findMany({ where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] }, ...(f.partnerId ? { partnerId: f.partnerId } : {}) }, include: { partner: true, contact: true }, orderBy: { dueDate: "asc" } }),
    prisma.bill.findMany({ where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } }, orderBy: { dueDate: "asc" } }),
    prisma.stockLevel.findMany({ where: { quantity: { not: 0 } }, include: { item: true, location: true } }),
    lowStockItems(),
    prisma.salesReport.groupBy({ by: ["reportDate"], where: salesWhere(f, range), _sum: { netSales: true }, orderBy: { reportDate: "asc" } }),
    prisma.salesReport.groupBy({ by: ["partnerId"], where: salesWhere(f, range), _sum: { netSales: true } }),
    prisma.salesReport.groupBy({ by: ["machineId"], where: salesWhere(f, range), _sum: { netSales: true, estimatedProfit: true } }),
  ]);

  const machineCount = (s: string) => machineGroups.find((g) => g.status === s)?._count ?? 0;
  const overdue = receivables.filter((r) => r.dueDate < today);
  const upcoming = receivables.filter((r) => r.dueDate >= today && r.dueDate <= addDays(today, 7));
  const invValueCost = levels.reduce((a, l) => a.plus(D(l.quantity).times(D(l.item.avgCost))), new Decimal(0));
  const whValueCost = levels.filter((l) => l.location.type === "WAREHOUSE").reduce((a, l) => a.plus(D(l.quantity).times(D(l.item.avgCost))), new Decimal(0));

  // Monthly performance: last 12 months
  const months: { start: Date; end: Date; label: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const s = startOfMonth(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1)));
    months.push({ start: s, end: endOfMonth(s), label: monthLabel(s) });
  }
  const yearStart = months[0].start;
  const [monthlySales, monthlySettlements, monthlySupply] = await Promise.all([
    prisma.salesReport.findMany({ where: salesWhere(f, { gte: yearStart, lte: today }), select: { reportDate: true, netSales: true, estimatedProfit: true } }),
    prisma.settlement.findMany({ where: { status: "FINALIZED", periodEnd: { gte: yearStart }, partner: partnerScope }, select: { periodEnd: true, ownerShare: true, partnerShare: true } }),
    prisma.invoice.findMany({ where: { type: "SUPPLY", status: { not: "CANCELLED" }, issueDate: { gte: yearStart }, partner: partnerScope }, select: { issueDate: true, amount: true, costAmount: true } }),
  ]);
  const monthly = months.map((m) => {
    const inM = (d: Date) => d >= m.start && d <= m.end;
    const sales = monthlySales.filter((r) => inM(r.reportDate));
    return {
      month: m.label,
      sales: n(sales.reduce((a, r) => a.plus(D(r.netSales)), new Decimal(0))),
      grossProfit: n(sales.reduce((a, r) => a.plus(D(r.estimatedProfit)), new Decimal(0))),
      ownerIncome: n(monthlySettlements.filter((s) => inM(s.periodEnd)).reduce((a, s) => a.plus(D(s.ownerShare)), new Decimal(0))),
      partnerEarnings: n(monthlySettlements.filter((s) => inM(s.periodEnd)).reduce((a, s) => a.plus(D(s.partnerShare)), new Decimal(0))),
      supplyMarkup: n(monthlySupply.filter((i) => inM(i.issueDate)).reduce((a, i) => a.plus(D(i.amount).minus(D(i.costAmount))), new Decimal(0))),
    };
  });

  const partners = await prisma.partner.findMany({ where: { id: { in: salesByPartner.map((s) => s.partnerId) } }, select: { id: true, businessName: true } });
  const machines = await prisma.machine.findMany({ where: { id: { in: salesByMachine.map((s) => s.machineId).filter(Boolean) as string[] } }, select: { id: true, code: true } });

  // Supply consumption (theoretical usage + wastage) by category in range, at partner locations
  const consumption = await prisma.stockMovement.findMany({
    where: { type: { in: ["CONSUMPTION", "WASTAGE"] }, occurredAt: { gte: manilaDayStart(f.from), lt: manilaDayStart(addDays(f.to, 1)) }, location: { type: "PARTNER", ...(f.partnerId ? { partnerId: f.partnerId } : {}) } },
    select: { quantity: true, unitPrice: true, type: true, item: { select: { category: true } } },
  });
  const byCat = new Map<string, Decimal>();
  for (const c of consumption) byCat.set(c.item.category, (byCat.get(c.item.category) ?? new Decimal(0)).plus(D(c.quantity).negated().times(D(c.unitPrice))));

  // Aging buckets
  const bucket = (due: Date) => {
    const days = Math.floor((today.getTime() - due.getTime()) / 86400000);
    return days <= 0 ? "Current" : days <= 30 ? "1–30 days" : days <= 60 ? "31–60 days" : "60+ days";
  };
  const buckets = ["Current", "1–30 days", "31–60 days", "60+ days"].map((b) => ({
    bucket: b,
    receivable: n(receivables.filter((r) => bucket(r.dueDate) === b).reduce((a, r) => a.plus(balanceOf(r)), new Decimal(0))),
    payable: n(payables.filter((r) => bucket(r.dueDate) === b).reduce((a, r) => a.plus(balanceOf(r)), new Decimal(0))),
  }));

  return {
    cards: {
      activePartners,
      machinesDeployed: machineCount("DEPLOYED"),
      machinesAvailable: machineCount("AVAILABLE") + machineCount("RETURNED"),
      machinesMaintenance: machineCount("UNDER_MAINTENANCE"),
      salesToday: money(salesToday._sum.netSales),
      salesRange: money(salesRange._sum.netSales),
      reportsInRange: salesRange._count,
      unitsInRange: salesRange._sum.totalUnits ?? 0,
      grossProfit: money(D(salesRange._sum.netSales).minus(D(salesRange._sum.estimatedCogs))),
      ownerIncome: money(settlements._sum.ownerShare),
      partnerEarnings: money(settlements._sum.partnerShare),
      supplyMarkup: money(D(supplyInvoices._sum.amount).minus(D(supplyInvoices._sum.costAmount))),
      receivables: money(receivables.reduce((a, r) => a.plus(balanceOf(r)), new Decimal(0))),
      payables: money(payables.reduce((a, r) => a.plus(balanceOf(r)), new Decimal(0))),
      inventoryValue: money(invValueCost),
      warehouseValue: money(whValueCost),
      overdueAmount: money(overdue.reduce((a, r) => a.plus(balanceOf(r)), new Decimal(0))),
    },
    lowStock: lowStock.slice(0, 8),
    overdue: overdue.slice(0, 8),
    upcoming: upcoming.slice(0, 8),
    charts: {
      daily: dailySales.map((d) => ({ date: fmtDate(d.reportDate).slice(0, 5), sales: n(d._sum.netSales) })),
      monthly,
      byPartner: salesByPartner.map((s) => ({ name: partners.find((p) => p.id === s.partnerId)?.businessName ?? "—", sales: n(s._sum.netSales) })).sort((a, b) => b.sales - a.sales).slice(0, 10),
      byMachine: salesByMachine.map((s) => ({ name: machines.find((m) => m.id === s.machineId)?.code ?? "No machine", sales: n(s._sum.netSales), profit: n(s._sum.estimatedProfit) })).sort((a, b) => b.profit - a.profit).slice(0, 10),
      consumption: [...byCat.entries()].map(([name, v]) => ({ name: name.replace(/_/g, " ").toLowerCase(), value: n(v) })),
      aging: buckets,
    },
    range: { from: ymd(f.from), to: ymd(f.to) },
  };
}

/** Totals for one period — used to compare the selected period with the one before it. */
export async function periodTotals(f: DashboardFilters) {
  const range = { gte: f.from, lte: f.to };
  const partnerScope: Prisma.PartnerWhereInput = { ...(f.partnerId ? { id: f.partnerId } : {}), ...(f.area ? { area: { contains: f.area, mode: "insensitive" } } : {}) };
  const [sales, settlements, supply] = await Promise.all([
    prisma.salesReport.aggregate({ where: salesWhere(f, range), _sum: { netSales: true, estimatedCogs: true, totalUnits: true }, _count: true }),
    prisma.settlement.aggregate({ where: { status: "FINALIZED", periodEnd: range, partner: partnerScope }, _sum: { ownerShare: true, partnerShare: true } }),
    prisma.invoice.aggregate({ where: { type: "SUPPLY", status: { not: "CANCELLED" }, issueDate: range, partner: partnerScope }, _sum: { amount: true, costAmount: true } }),
  ]);
  return {
    sales: money(sales._sum.netSales),
    grossProfit: money(D(sales._sum.netSales).minus(D(sales._sum.estimatedCogs))),
    units: sales._sum.totalUnits ?? 0,
    reports: sales._count,
    ownerIncome: money(settlements._sum.ownerShare),
    partnerEarnings: money(settlements._sum.partnerShare),
    supplyMarkup: money(D(supply._sum.amount).minus(D(supply._sum.costAmount))),
  };
}

/** % change vs the previous period (null when there is nothing to compare with). */
export function pctChange(now: Decimal | number, before: Decimal | number): Decimal | null {
  const b = D(before);
  if (b.isZero()) return null;
  return D(now).minus(b).dividedBy(b.abs()).times(100);
}

/** One row per partner for the dashboard table: period sales, gross profit, what they owe. */
export async function partnerPerformance(f: DashboardFilters, q?: string) {
  const today = todayDate();
  const partners = await prisma.partner.findMany({
    where: {
      status: { in: ["ACTIVE", "ON_HOLD", "PENDING_APPROVAL"] },
      ...(f.partnerId ? { id: f.partnerId } : {}),
      ...(f.area ? { area: { contains: f.area, mode: "insensitive" } } : {}),
      ...(q ? { OR: [{ businessName: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { area: { contains: q, mode: "insensitive" } }] } : {}),
    },
    include: { machines: { select: { code: true } } },
  });
  const ids = partners.map((p) => p.id);
  const [sales, open] = await Promise.all([
    prisma.salesReport.groupBy({ by: ["partnerId"], where: { ...salesWhere({ ...f, partnerId: undefined }, { gte: f.from, lte: f.to }), partnerId: { in: ids } }, _sum: { netSales: true, estimatedProfit: true, totalUnits: true }, _max: { reportDate: true } }),
    prisma.invoice.findMany({ where: { partnerId: { in: ids }, status: { in: ["UNPAID", "PARTIALLY_PAID"] } }, select: { partnerId: true, amount: true, amountPaid: true, dueDate: true } }),
  ]);
  return partners.map((p) => {
    const s = sales.find((x) => x.partnerId === p.id);
    const inv = open.filter((i) => i.partnerId === p.id);
    const owed = inv.reduce((a, i) => a.plus(balanceOf(i)), new Decimal(0));
    const overdue = inv.filter((i) => i.dueDate < today).reduce((a, i) => a.plus(balanceOf(i)), new Decimal(0));
    return { partner: p, sales: money(s?._sum.netSales), profit: money(s?._sum.estimatedProfit), units: s?._sum.totalUnits ?? 0, lastReport: s?._max.reportDate ?? null, owed: money(owed), overdue: money(overdue) };
  }).sort((a, b) => b.sales.comparedTo(a.sales));
}
