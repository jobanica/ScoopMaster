import type { CogsBasis } from "@prisma/client";
import { prisma, withTx, type Tx } from "@/lib/db";
import { nextCode } from "@/lib/sequence";
import { audit } from "@/lib/audit";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { D, money, qty, Decimal } from "@/lib/money";
import { computeSales } from "@/lib/calc/sales";
import { consumptionPerUnit } from "@/lib/calc/recipe";
import { addDays, fmtDate, manilaDayStart, todayDate } from "@/lib/dates";
import type { Actor } from "../actor";
import { ensurePartnerLocation, postMovement } from "./inventory";
import { assertPeriodOpen } from "./periods";
import { contractOn } from "./partners";
import { getRule, notify, notifyPartner } from "./notifications";

const productInclude = {
  components: { include: { item: true } },
  recipe: { include: { ingredients: { include: { item: true } } } },
} as const;

/** Products with the partner's configured selling price and theoretical cost/consumption per unit. */
export async function partnerPricing(db: Tx | typeof prisma, partnerId: string, basis: CogsBasis = "TRANSFER_PRICE") {
  const [products, overrides] = await Promise.all([
    db.product.findMany({ where: { isActive: true }, include: productInclude, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    db.partnerProductPrice.findMany({ where: { partnerId, isActive: true } }),
  ]);
  const priceBy = new Map(overrides.map((o) => [o.productId, o.price]));
  return products.map((p) => {
    const consumption = consumptionPerUnit(p, p.recipe);
    const items = new Map<string, { avgCost: Decimal; partnerPrice: Decimal }>();
    for (const c of p.components) items.set(c.itemId, { avgCost: D(c.item.avgCost), partnerPrice: D(c.item.partnerPrice) });
    for (const i of p.recipe?.ingredients ?? []) if (i.item) items.set(i.item.id, { avgCost: D(i.item.avgCost), partnerPrice: D(i.item.partnerPrice) });
    let unitCost = new Decimal(0);
    for (const [itemId, q] of consumption) {
      const it = items.get(itemId)!;
      unitCost = unitCost.plus(q.times(basis === "OWNER_COST" ? it.avgCost : it.partnerPrice));
    }
    return {
      product: p,
      price: D(priceBy.get(p.id) ?? p.defaultPrice),
      hasOverride: priceBy.has(p.id),
      unitCost: qty(unitCost),
      consumption,
    };
  });
}

export type SalesReportInput = {
  partnerId: string;
  machineId?: string | null;
  reportDate: Date;
  lines: { productId: string; quantity: number; wastageQty: number }[];
  discounts: string;
  refunds: string;
  reportedTotal?: string | null;
  cashSales: string;
  gcashSales: string;
  otherSales: string;
  actualCash?: string | null;
  notes?: string | null;
  stockLines?: { itemId: string; opening: string; received: string; closing: string }[];
  source?: string;
};

export async function saveSalesReport(actor: Actor, input: SalesReportInput, opts: { submit: boolean }) {
  const partnerId = actor.role === "PARTNER" ? actor.partnerId : input.partnerId;
  if (!partnerId) throw new ForbiddenError();
  if (input.reportDate > todayDate()) throw new AppError("Sales cannot be reported for a future date.");

  const result = await withTx(async (tx) => {
    const partner = await tx.partner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new NotFoundError("Partner");
    if (!["ACTIVE", "ON_HOLD"].includes(partner.status)) throw new AppError("Sales can only be reported for active partners.");
    await assertPeriodOpen(tx, partnerId, input.reportDate);

    // Machine must have been assigned to this partner on the report date.
    const assignments = await tx.machineAssignment.findMany({
      where: { partnerId, startDate: { lte: input.reportDate }, OR: [{ endDate: null }, { endDate: { gte: input.reportDate } }] },
    });
    let machineId = input.machineId || null;
    if (!machineId && assignments.length === 1) machineId = assignments[0].machineId;
    if (assignments.length > 0 && !machineId) throw new AppError("Select the machine this report is for.");
    if (machineId && !assignments.some((a) => a.machineId === machineId)) throw new AppError("That machine was not assigned to this partner on the report date.");

    const existing = await tx.salesReport.findFirst({ where: { partnerId, machineId, reportDate: input.reportDate } });
    if (existing && !["DRAFT", "REJECTED"].includes(existing.status)) {
      throw new AppError(`A ${existing.status.toLowerCase()} report (${existing.number}) already exists for ${fmtDate(input.reportDate)}. Request an edit instead.`);
    }

    const contract = await contractOn(tx, partnerId, input.reportDate);
    const pricing = await partnerPricing(tx, partnerId, contract?.cogsBasis ?? "TRANSFER_PRICE");
    const byProduct = new Map(pricing.map((p) => [p.product.id, p]));
    const lines = input.lines
      .filter((l) => l.quantity > 0 || l.wastageQty > 0)
      .map((l) => {
        const p = byProduct.get(l.productId);
        if (!p) throw new AppError("Unknown or inactive product in report.");
        return { productId: l.productId, quantity: l.quantity, wastageQty: l.wastageQty, unitPrice: p.price, unitCost: p.unitCost };
      });
    if (opts.submit && lines.length === 0) throw new AppError("Enter at least one product sold (or wastage) before submitting.");

    const tolerance = (await getRule("CASH_DISCREPANCY", tx)).threshold;
    const c = computeSales({
      lines, discounts: input.discounts || 0, refunds: input.refunds || 0, reportedTotal: input.reportedTotal || null,
      cashSales: input.cashSales || 0, gcashSales: input.gcashSales || 0, otherSales: input.otherSales || 0, actualCash: input.actualCash || null, tolerance,
    });

    const data = {
      partnerId, machineId, reportDate: input.reportDate, source: input.source ?? "MANUAL",
      totalUnits: c.totalUnits, wastageUnits: c.wastageUnits, grossSales: c.grossSales.toString(), discounts: c.discounts.toString(), refunds: c.refunds.toString(),
      netSales: c.netSales.toString(), reportedTotal: c.reportedTotal.toString(), salesVariance: c.salesVariance.toString(),
      cashSales: money(input.cashSales || 0).toString(), gcashSales: money(input.gcashSales || 0).toString(), otherSales: money(input.otherSales || 0).toString(),
      expectedCash: c.expectedCash.toString(), actualCash: c.actualCash.toString(), cashVariance: c.cashVariance.toString(),
      estimatedCogs: c.estimatedCogs.toString(), estimatedProfit: c.estimatedProfit.toString(),
      hasDiscrepancy: c.hasDiscrepancy, discrepancyNotes: c.discrepancies.join("; ") || null, notes: input.notes,
      status: opts.submit ? ("SUBMITTED" as const) : ("DRAFT" as const),
      submittedAt: opts.submit ? new Date() : null, submittedById: opts.submit ? actor.id : null,
    };
    const lineRows = lines.map((l, i) => ({ productId: l.productId, quantity: l.quantity, wastageQty: l.wastageQty, unitPrice: money(l.unitPrice).toString(), unitCost: l.unitCost.toString(), lineTotal: c.lineTotals[i].toString() }));
    const stockRows = (input.stockLines ?? []).filter((s) => s.opening !== "" || s.closing !== "").map((s) => ({ itemId: s.itemId, opening: qty(s.opening || 0).toString(), received: qty(s.received || 0).toString(), closing: qty(s.closing || 0).toString() }));

    let report;
    if (existing) {
      await tx.salesReportLine.deleteMany({ where: { reportId: existing.id } });
      await tx.salesReportStock.deleteMany({ where: { reportId: existing.id } });
      report = await tx.salesReport.update({ where: { id: existing.id }, data: { ...data, lines: { create: lineRows }, stockLines: { create: stockRows } } });
    } else {
      report = await tx.salesReport.create({ data: { ...data, number: await nextCode(tx, "SR", 7), createdById: actor.id, lines: { create: lineRows }, stockLines: { create: stockRows } } });
    }
    await audit(tx, { userId: actor.id, action: opts.submit ? "SALES_SUBMIT" : existing ? "SALES_UPDATE" : "SALES_CREATE", entityType: "SalesReport", entityId: report.id, before: existing, after: report });

    if (opts.submit && c.hasDiscrepancy) {
      await notify("CASH_DISCREPANCY", { title: `Discrepancy in ${report.number} – ${partner.businessName}`, body: c.discrepancies.join("; "), link: `/sales/${report.id}`, severity: "WARNING", dedupeKey: `disc-${report.id}-${report.revision}` }, tx);
    }
    return { report, partner, computed: c };
  });

  if (opts.submit) await checkSalesDrop(result.partner.id, result.partner.businessName, input.reportDate, result.computed.netSales).catch(() => undefined);
  return result.report;
}

async function checkSalesDrop(partnerId: string, name: string, date: Date, netSales: Decimal) {
  const rule = await getRule("SALES_DROP");
  if (!rule.enabled) return;
  const prev = await prisma.salesReport.groupBy({
    by: ["reportDate"], where: { partnerId, status: { in: ["SUBMITTED", "APPROVED"] }, reportDate: { gte: addDays(date, -7), lt: date } }, _sum: { netSales: true },
  });
  if (prev.length < 3) return;
  const avg = prev.reduce((a, r) => a.plus(D(r._sum.netSales)), new Decimal(0)).dividedBy(prev.length);
  if (avg.lte(0)) return;
  const drop = avg.minus(netSales).dividedBy(avg).times(100);
  if (drop.gte(rule.threshold)) {
    await notify("SALES_DROP", { title: `Sales drop at ${name}`, body: `${fmtDate(date)} net sales ${netSales.toFixed(2)} is ${drop.toFixed(0)}% below the 7-day average (${avg.toFixed(2)}).`, link: `/partners/${partnerId}`, severity: "WARNING", dedupeKey: `drop-${partnerId}-${date.toISOString().slice(0, 10)}` });
  }
}

/** Approve a submitted report and post theoretical consumption + wastage to the partner location's ledger. */
async function approveInTx(tx: Tx, actor: Actor, id: string, notes?: string | null) {
  const r = await tx.salesReport.findUnique({ where: { id }, include: { lines: true } });
  if (!r) throw new NotFoundError("Sales report");
  if (r.status !== "SUBMITTED") throw new AppError(`Only submitted reports can be approved (${r.number} is ${r.status.toLowerCase()}).`);
  await assertPeriodOpen(tx, r.partnerId, r.reportDate);
  const loc = await ensurePartnerLocation(tx, r.partnerId);
  const pricing = await partnerPricing(tx, r.partnerId);
  const byProduct = new Map(pricing.map((p) => [p.product.id, p]));
  const consumption = new Map<string, Decimal>();
  const wastage = new Map<string, Decimal>();
  for (const line of r.lines) {
    const p = byProduct.get(line.productId);
    if (!p) continue;
    for (const [itemId, perUnit] of p.consumption) {
      if (line.quantity > 0) consumption.set(itemId, (consumption.get(itemId) ?? new Decimal(0)).plus(perUnit.times(line.quantity)));
      if (line.wastageQty > 0) wastage.set(itemId, (wastage.get(itemId) ?? new Decimal(0)).plus(perUnit.times(line.wastageQty)));
    }
  }
  const occurredAt = new Date(manilaDayStart(r.reportDate).getTime() + 12 * 3600000); // midday of the report date (Manila)
  for (const [map, type] of [[consumption, "CONSUMPTION"], [wastage, "WASTAGE"]] as const) {
    for (const [itemId, q] of map) {
      const rq = qty(q);
      if (rq.isZero()) continue;
      await postMovement(tx, { type, itemId, locationId: loc.id, quantity: rq.negated(), sourceType: "SalesReport", sourceId: r.id, reason: `${r.number} (${fmtDate(r.reportDate)})`, userId: actor.id, occurredAt });
    }
  }
  const after = await tx.salesReport.update({ where: { id }, data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: actor.id, reviewNotes: notes ?? r.reviewNotes } });
  await audit(tx, { userId: actor.id, action: "SALES_APPROVE", entityType: "SalesReport", entityId: id, summary: notes ?? undefined });
  return after;
}

export async function approveSalesReport(actor: Actor, id: string, notes?: string | null) {
  return withTx((tx) => approveInTx(tx, actor, id, notes));
}

/** Bulk-approve submitted reports with no discrepancy (each in its own transaction). */
export async function approveCleanReports(actor: Actor, ids?: string[]) {
  const reports = await prisma.salesReport.findMany({ where: { status: "SUBMITTED", hasDiscrepancy: false, ...(ids ? { id: { in: ids } } : {}) }, select: { id: true } });
  let ok = 0;
  const errors: string[] = [];
  for (const r of reports) {
    try {
      await withTx((tx) => approveInTx(tx, actor, r.id));
      ok++;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { approved: ok, errors };
}

export async function rejectSalesReport(actor: Actor, id: string, notes: string) {
  if (!notes?.trim()) throw new AppError("Tell the partner why the report is rejected.");
  return withTx(async (tx) => {
    const r = await tx.salesReport.findUnique({ where: { id } });
    if (!r) throw new NotFoundError("Sales report");
    if (r.status !== "SUBMITTED") throw new AppError("Only submitted reports can be rejected.");
    const after = await tx.salesReport.update({ where: { id }, data: { status: "REJECTED", reviewNotes: notes, reviewedAt: new Date(), reviewedById: actor.id } });
    await audit(tx, { userId: actor.id, action: "SALES_REJECT", entityType: "SalesReport", entityId: id, summary: notes });
    await notifyPartner(r.partnerId, "GENERAL", { title: `Sales report ${r.number} needs correction`, body: notes, link: `/portal/sales/${r.id}`, severity: "WARNING", dedupeKey: `rej-${r.id}-${r.revision}` }, tx);
    return after;
  });
}

/** Re-opens a submitted/approved report for editing; reverses its ledger postings. Audited. */
async function reopenInTx(tx: Tx, actor: Actor, id: string, reason: string) {
  const r = await tx.salesReport.findUnique({ where: { id } });
  if (!r) throw new NotFoundError("Sales report");
  if (!["SUBMITTED", "APPROVED"].includes(r.status)) throw new AppError("Only submitted or approved reports can be reopened.");
  if (r.settlementId) {
    const s = await tx.settlement.findUnique({ where: { id: r.settlementId } });
    if (s && s.status !== "VOIDED" && s.status !== "DRAFT") throw new AppError(`Report is included in settlement ${s.number}. Void that settlement first.`);
  }
  await assertPeriodOpen(tx, r.partnerId, r.reportDate);
  if (r.status === "APPROVED") {
    const mvs = await tx.stockMovement.findMany({ where: { sourceType: "SalesReport", sourceId: r.id, reversedBy: null, type: { in: ["CONSUMPTION", "WASTAGE"] } } });
    for (const mv of mvs) {
      await postMovement(tx, { type: "REVERSAL", itemId: mv.itemId, locationId: mv.locationId, quantity: D(mv.quantity).negated(), unitCost: mv.unitCost, unitPrice: mv.unitPrice, reversesId: mv.id, sourceType: "SalesReport", sourceId: r.id, reason: `Reopened: ${reason}`, userId: actor.id, occurredAt: mv.occurredAt });
    }
  }
  const after = await tx.salesReport.update({ where: { id }, data: { status: "DRAFT", revision: { increment: 1 }, settlementId: null, reviewNotes: `Reopened: ${reason}` } });
  await audit(tx, { userId: actor.id, action: "SALES_REOPEN", entityType: "SalesReport", entityId: id, summary: reason, before: r, after });
  return after;
}

export async function reopenSalesReport(actor: Actor, id: string, reason: string) {
  if (!reason?.trim()) throw new AppError("A reason is required.");
  return withTx((tx) => reopenInTx(tx, actor, id, reason));
}

export async function requestSalesEdit(actor: Actor, reportId: string, reason: string) {
  if (!reason?.trim()) throw new AppError("Please explain what needs to be corrected.");
  return withTx(async (tx) => {
    const r = await tx.salesReport.findUnique({ where: { id: reportId }, include: { partner: true } });
    if (!r) throw new NotFoundError("Sales report");
    if (actor.role === "PARTNER" && r.partnerId !== actor.partnerId) throw new ForbiddenError();
    if (!["SUBMITTED", "APPROVED"].includes(r.status)) throw new AppError("Draft and rejected reports can be edited directly.");
    const pending = await tx.salesEditRequest.findFirst({ where: { reportId, status: "PENDING" } });
    if (pending) throw new AppError("An edit request for this report is already pending.");
    const req = await tx.salesEditRequest.create({ data: { reportId, reason, requestedById: actor.id } });
    await audit(tx, { userId: actor.id, action: "SALES_EDIT_REQUEST", entityType: "SalesReport", entityId: reportId, summary: reason });
    await notify("EDIT_REQUEST", { title: `Edit requested: ${r.number} (${r.partner.businessName})`, body: reason, link: `/sales/${r.id}`, dedupeKey: `edit-${req.id}` }, tx);
    return req;
  });
}

export async function reviewSalesEdit(actor: Actor, requestId: string, approve: boolean, notes?: string | null) {
  return withTx(async (tx) => {
    const req = await tx.salesEditRequest.findUnique({ where: { id: requestId }, include: { report: true } });
    if (!req) throw new NotFoundError("Edit request");
    if (req.status !== "PENDING") throw new AppError("This request has already been reviewed.");
    if (approve) await reopenInTx(tx, actor, req.reportId, `Edit request approved: ${req.reason}`);
    await tx.salesEditRequest.update({ where: { id: requestId }, data: { status: approve ? "APPROVED" : "REJECTED", reviewedById: actor.id, reviewedAt: new Date(), reviewNotes: notes } });
    await audit(tx, { userId: actor.id, action: approve ? "SALES_EDIT_APPROVE" : "SALES_EDIT_REJECT", entityType: "SalesReport", entityId: req.reportId, summary: notes ?? undefined });
    await notifyPartner(req.report.partnerId, "EDIT_REQUEST", { title: `Edit request for ${req.report.number} ${approve ? "approved – you can now edit and resubmit" : "declined"}`, body: notes ?? undefined, link: `/portal/sales/${req.reportId}`, dedupeKey: `editrev-${req.id}` }, tx);
  });
}

/** Active partners with no report for a given date (for alerts and the dashboard). */
export async function partnersMissingReports(date: Date) {
  const partners = await prisma.partner.findMany({
    where: { status: "ACTIVE", machines: { some: {} } },
    include: { salesReports: { where: { reportDate: date, status: { in: ["SUBMITTED", "APPROVED"] } }, select: { id: true } } },
  });
  return partners.filter((p) => p.salesReports.length === 0);
}
