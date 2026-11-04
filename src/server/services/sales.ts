import type { CogsBasis } from "@prisma/client";
import { prisma, withTx, type Tx } from "@/lib/db";
import { nextCode } from "@/lib/sequence";
import { audit } from "@/lib/audit";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { D, money, qty, Decimal } from "@/lib/money";
import { computeSales } from "@/lib/calc/sales";
import { computeCountReport, type CountItem } from "@/lib/calc/count";
import { consumptionPerUnit } from "@/lib/calc/recipe";
import { addDays, fmtDate, manilaDayStart, todayDate } from "@/lib/dates";
import type { Actor } from "../actor";
import { ensurePartnerLocation, postMovement } from "./inventory";
import { assertPeriodOpen } from "./periods";
import { contractOn } from "./partners";
import { getRule, notify, notifyPartner } from "./notifications";
import { INFLOW_TYPES, closeShiftWithReport, openShiftFor, reopenShiftForReport } from "./shifts";

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
    if (contract?.reportingMethod === "INVENTORY_COUNT") throw new AppError("This partner reports sales by closing inventory count. Use the closing count form.");
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
  if (r.method === "INVENTORY_COUNT") {
    // Actual usage was already posted from the closing count at submission.
    const after = await tx.salesReport.update({ where: { id }, data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: actor.id, reviewNotes: notes ?? r.reviewNotes } });
    await audit(tx, { userId: actor.id, action: "SALES_APPROVE", entityType: "SalesReport", entityId: id, summary: notes ?? undefined });
    return after;
  }
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
  if (r.status === "APPROVED" || r.method === "INVENTORY_COUNT") {
    if (r.method === "INVENTORY_COUNT") {
      const later = await tx.salesReport.findFirst({ where: { partnerId: r.partnerId, method: "INVENTORY_COUNT", reportDate: { gt: r.reportDate }, status: { in: ["SUBMITTED", "APPROVED"] } } });
      if (later) throw new AppError(`A later count (${later.number}, ${fmtDate(later.reportDate)}) is based on this one. Reopen the later report first.`);
    }
    const mvs = await tx.stockMovement.findMany({ where: { sourceType: "SalesReport", sourceId: r.id, reversedBy: null, type: { in: ["CONSUMPTION", "WASTAGE"] } } });
    for (const mv of mvs) {
      await postMovement(tx, { type: "REVERSAL", itemId: mv.itemId, locationId: mv.locationId, quantity: D(mv.quantity).negated(), unitCost: mv.unitCost, unitPrice: mv.unitPrice, reversesId: mv.id, sourceType: "SalesReport", sourceId: r.id, reason: `Reopened: ${reason}`, userId: actor.id, occurredAt: mv.occurredAt });
    }
  }
  if (r.method === "INVENTORY_COUNT") await reopenShiftForReport(tx, r.id);
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


// ───────────── INVENTORY_COUNT reporting ─────────────

export const POWDER_TOLERANCE_PCT = 15; // allowed excess powder use over what counted sales explain (wastage, mix left in machine)
const DRIVER_CATEGORIES = ["CONES", "CUPS"] as const;

/** Which product's price applies to each counted container (cones, cups) for this partner. */
export async function countDrivers(db: Tx | typeof prisma, partnerId: string) {
  const [containers, mappings, products] = await Promise.all([
    db.inventoryItem.findMany({ where: { isActive: true, category: { in: [...DRIVER_CATEGORIES] } }, orderBy: { name: "asc" } }),
    db.partnerCountProduct.findMany({ where: { partnerId } }),
    db.product.findMany({ where: { isActive: true }, include: { components: true } }),
  ]);
  return containers.map((c) => {
    const users = products.filter((p) => p.components.some((x) => x.itemId === c.id));
    const mapped = mappings.find((m) => m.itemId === c.id);
    const product = mapped ? products.find((p) => p.id === mapped.productId) ?? null : users.length === 1 ? users[0] : null;
    return { item: c, product, candidates: users, configured: !!mapped };
  });
}

export async function setCountProduct(actor: Actor, partnerId: string, itemId: string, productId: string | null) {
  return withTx(async (tx) => {
    if (productId) {
      const prod = await tx.product.findUnique({ where: { id: productId }, include: { components: true } });
      if (!prod || !prod.components.some((c) => c.itemId === itemId)) throw new AppError("That product does not use this container.");
      await tx.partnerCountProduct.upsert({ where: { partnerId_itemId: { partnerId, itemId } }, create: { partnerId, itemId, productId }, update: { productId } });
    } else {
      await tx.partnerCountProduct.deleteMany({ where: { partnerId, itemId } });
    }
    await audit(tx, { userId: actor.id, action: "COUNT_PRODUCT_SET", entityType: "Partner", entityId: partnerId, summary: `${itemId} → ${productId ?? "auto"}` });
  });
}

/** Stock the ledger says is on hand at the end of a business date (later movements excluded). */
async function expectedOnHand(db: Tx | typeof prisma, locationId: string, date: Date) {
  const cutoff = manilaDayStart(addDays(date, 1));
  const [levels, later] = await Promise.all([
    db.stockLevel.findMany({ where: { locationId } }),
    db.stockMovement.groupBy({ by: ["itemId"], where: { locationId, occurredAt: { gte: cutoff } }, _sum: { quantity: true } }),
  ]);
  const map = new Map<string, Decimal>();
  for (const l of levels) map.set(l.itemId, D(l.quantity));
  for (const m of later) map.set(m.itemId, (map.get(m.itemId) ?? new Decimal(0)).minus(D(m._sum.quantity)));
  return map;
}

/** Everything the closing-count form needs. */
export async function countFormData(db: Tx | typeof prisma, partnerId: string, date: Date) {
  const contract = await contractOn(db, partnerId, date);
  const basis = contract?.cogsBasis ?? "TRANSFER_PRICE";
  const loc = await db.location.findUnique({ where: { partnerId } });
  const [onHand, drivers, items, pricing] = await Promise.all([
    loc ? expectedOnHand(db, loc.id, date) : new Map<string, Decimal>(),
    countDrivers(db, partnerId),
    db.inventoryItem.findMany({ where: { isActive: true }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    partnerPricing(db, partnerId, basis),
  ]);
  const driverIds = new Set(drivers.filter((d) => d.product).map((d) => d.item.id));
  const usedInProducts = new Set(pricing.flatMap((p) => [...p.consumption.keys()]));
  // Received during the shift (or the business day if no shift was opened)
  const shift = await db.shift.findUnique({ where: { partnerId_businessDate: { partnerId, businessDate: date } } });
  const since = shift && !shift.autoOpened ? shift.openedAt : manilaDayStart(date);
  const inflows = loc ? await db.stockMovement.groupBy({ by: ["itemId"], where: { locationId: loc.id, type: { in: INFLOW_TYPES }, occurredAt: { gte: since, lt: manilaDayStart(addDays(date, 1)) } }, _sum: { quantity: true } }) : [];
  const rows = items
    .filter((i) => driverIds.has(i.id) || i.category === "ICE_CREAM_POWDER" || D(onHand.get(i.id)).gt(0) || usedInProducts.has(i.id))
    .map((i) => ({
      item: i,
      expected: qty(onHand.get(i.id) ?? 0),
      received: qty(inflows.find((x) => x.itemId === i.id)?._sum.quantity ?? 0),
      unitValue: D(basis === "OWNER_COST" ? i.avgCost : i.partnerPrice),
      isContainer: driverIds.has(i.id),
      required: driverIds.has(i.id) || i.category === "ICE_CREAM_POWDER",
    }));
  return { contract, drivers, rows: rows.map((r) => ({ ...r, opening: r.expected.minus(r.received) })), pricing, shift };
}

export type CountReportInput = {
  partnerId: string;
  reportDate: Date;
  counts: { itemId: string; closing: string | null; wasted: string | null }[];
  discounts: string;
  refunds: string;
  cashSales: string;
  gcashSales: string;
  otherSales: string;
  actualCash?: string | null;
  notes?: string | null;
};

export async function saveCountReport(actor: Actor, input: CountReportInput, opts: { submit: boolean }) {
  const partnerId = actor.role === "PARTNER" ? actor.partnerId : input.partnerId;
  if (!partnerId) throw new ForbiddenError();
  if (input.reportDate > todayDate()) throw new AppError("Counts cannot be reported for a future date.");
  return withTx(async (tx) => {
    const partner = await tx.partner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new NotFoundError("Partner");
    if (!["ACTIVE", "ON_HOLD"].includes(partner.status)) throw new AppError("Sales can only be reported for active partners.");
    await assertPeriodOpen(tx, partnerId, input.reportDate);
    const data = await countFormData(tx, partnerId, input.reportDate);
    if (data.contract?.reportingMethod !== "INVENTORY_COUNT") throw new AppError("This partner's contract uses unit-based sales reporting.");
    const missing = data.drivers.filter((d) => !d.product && d.candidates.length > 1);
    if (missing.length) throw new AppError(`Scoop Master still needs to set which product ${missing.map((m) => m.item.name).join(", ")} are sold as (Partner → Prices).`);

    const existing = await tx.salesReport.findFirst({ where: { partnerId, reportDate: input.reportDate } });
    if (existing && !["DRAFT", "REJECTED"].includes(existing.status)) throw new AppError(`A ${existing.status.toLowerCase()} report (${existing.number}) already exists for ${fmtDate(input.reportDate)}. Request a correction instead.`);
    if (opts.submit) {
      const earlierShift = await openShiftFor(tx, partnerId, input.reportDate);
      if (earlierShift) throw new AppError(`The shift for ${fmtDate(earlierShift.businessDate)} is still open. Submit its closing count first.`);
      const later = await tx.salesReport.findFirst({ where: { partnerId, method: "INVENTORY_COUNT", reportDate: { gt: input.reportDate }, status: { in: ["SUBMITTED", "APPROVED"] } } });
      if (later) throw new AppError(`A count for a later date (${fmtDate(later.reportDate)}) was already submitted. Counts must be submitted in date order.`);
    }
    const assignments = await tx.machineAssignment.findMany({ where: { partnerId, startDate: { lte: input.reportDate }, OR: [{ endDate: null }, { endDate: { gte: input.reportDate } }] } });
    const machineId = assignments.length === 1 ? assignments[0].machineId : null;

    const countBy = new Map(input.counts.map((c) => [c.itemId, c]));
    const items: CountItem[] = data.rows.map((r) => {
      const c = countBy.get(r.item.id);
      const closing = c?.closing ?? null;
      if (r.required && opts.submit && (closing === null || closing === "")) throw new AppError(`Please count ${r.item.name}.`);
      return { itemId: r.item.id, name: r.item.name, expected: r.expected, closing: closing === "" ? null : closing, wasted: c?.wasted || 0, unitValue: r.unitValue, isContainer: r.isContainer };
    });
    const drivers = data.drivers.filter((d) => d.product).map((d) => ({ containerItemId: d.item.id, productId: d.product!.id, price: data.pricing.find((p) => p.product.id === d.product!.id)?.price ?? d.product!.defaultPrice }));
    const consumption = new Map(data.pricing.map((p) => [p.product.id, p.consumption]));
    let count;
    try {
      count = computeCountReport(opts.submit ? items : items.map((i) => (i.isContainer && (i.closing === null) ? { ...i, closing: i.expected } : i)), drivers, consumption, { tolerancePct: POWDER_TOLERANCE_PCT });
    } catch (e) {
      throw new AppError((e as Error).message);
    }
    const tolerance = (await getRule("CASH_DISCREPANCY", tx)).threshold;
    const c = computeSales({ lines: count.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })), discounts: input.discounts || 0, refunds: input.refunds || 0, cashSales: input.cashSales || 0, gcashSales: input.gcashSales || 0, otherSales: input.otherSales || 0, actualCash: input.actualCash || null, tolerance });
    const flagged = count.checks.filter((x) => x.flagged);
    const missingAtOpening = data.shift ? await tx.shiftLine.findMany({ where: { shiftId: data.shift.id, treatedAsSold: true }, include: { item: true } }) : [];
    const discrepancies = [...c.discrepancies, ...missingAtOpening.map((m) => `${D(m.variance).abs().toString()} ${m.item.name} missing at opening — counted as sold`), ...flagged.map((x) => `${x.name} used ${x.actualUse.toString()} vs ${x.expectedUse.toString()} needed for the counted sales (${x.variancePct ? `+${x.variancePct.toFixed(0)}%` : "no sales counted"}) — possible unreported sales or excess wastage`)];
    const powderCheck = count.checks.find((x) => x.variancePct !== null);

    const reportData = {
      partnerId, machineId, reportDate: input.reportDate, source: "COUNT", method: "INVENTORY_COUNT" as const,
      totalUnits: count.totalUnits, wastageUnits: count.items.filter((i) => data.rows.find((r) => r.item.id === i.itemId)?.isContainer).reduce((a, i) => a + i.wasted.toNumber(), 0),
      grossSales: c.grossSales.toString(), discounts: c.discounts.toString(), refunds: c.refunds.toString(), netSales: c.netSales.toString(),
      reportedTotal: c.netSales.toString(), salesVariance: "0",
      cashSales: money(input.cashSales || 0).toString(), gcashSales: money(input.gcashSales || 0).toString(), otherSales: money(input.otherSales || 0).toString(),
      expectedCash: c.expectedCash.toString(), actualCash: c.actualCash.toString(), cashVariance: c.cashVariance.toString(),
      estimatedCogs: count.cogs.toString(), estimatedProfit: c.netSales.minus(count.cogs).toString(), powderVariancePct: powderCheck?.variancePct?.toFixed(2) ?? null,
      hasDiscrepancy: discrepancies.length > 0, discrepancyNotes: discrepancies.join("; ") || null, notes: input.notes,
      status: opts.submit ? ("SUBMITTED" as const) : ("DRAFT" as const), submittedAt: opts.submit ? new Date() : null, submittedById: opts.submit ? actor.id : null,
    };
    const lineRows = count.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, wastageQty: 0, unitPrice: l.unitPrice.toString(), unitCost: "0", lineTotal: l.lineTotal.toString() }));
    const stockRows = data.rows.map((r) => {
      const ci = count.items.find((i) => i.itemId === r.item.id);
      const raw = countBy.get(r.item.id);
      return { itemId: r.item.id, opening: r.opening.toString(), received: r.received.toString(), closing: (ci?.closing ?? (raw?.closing ? D(raw.closing) : r.expected)).toString(), wasted: (ci?.wasted ?? 0).toString(), used: (ci?.used ?? 0).toString(), unitValue: r.unitValue.toString(), counted: ci ? ci.counted : !!raw?.closing };
    });

    let report;
    if (existing) {
      await tx.salesReportLine.deleteMany({ where: { reportId: existing.id } });
      await tx.salesReportStock.deleteMany({ where: { reportId: existing.id } });
      report = await tx.salesReport.update({ where: { id: existing.id }, data: { ...reportData, lines: { create: lineRows }, stockLines: { create: stockRows } } });
    } else {
      report = await tx.salesReport.create({ data: { ...reportData, number: await nextCode(tx, "SR", 7), createdById: actor.id, lines: { create: lineRows }, stockLines: { create: stockRows } } });
    }

    if (opts.submit) {
      await closeShiftWithReport(tx, actor, report, data.rows.map((r) => ({ itemId: r.item.id, opening: r.opening })));
      const loc = await ensurePartnerLocation(tx, partnerId);
      const occurredAt = new Date(manilaDayStart(input.reportDate).getTime() + 20 * 3600000); // closing time
      for (const i of count.items) {
        if (i.consumed.gt(0)) await postMovement(tx, { type: "CONSUMPTION", itemId: i.itemId, locationId: loc.id, quantity: i.consumed.negated(), sourceType: "SalesReport", sourceId: report.id, reason: `${report.number} closing count${i.counted ? "" : " (estimated, not counted)"}`, userId: actor.id, occurredAt });
        if (i.wasted.gt(0)) await postMovement(tx, { type: "WASTAGE", itemId: i.itemId, locationId: loc.id, quantity: i.wasted.negated(), sourceType: "SalesReport", sourceId: report.id, reason: `${report.number} reported wastage`, userId: actor.id, occurredAt });
      }
      if (discrepancies.length) {
        await notify("CASH_DISCREPANCY", { title: `Check ${report.number} – ${partner.businessName}`, body: discrepancies.join("; "), link: `/sales/${report.id}`, severity: "WARNING", dedupeKey: `disc-${report.id}-${report.revision}` }, tx);
      }
    }
    await audit(tx, { userId: actor.id, action: opts.submit ? "SALES_SUBMIT" : existing ? "SALES_UPDATE" : "SALES_CREATE", entityType: "SalesReport", entityId: report.id, before: existing, after: { report, counts: input.counts } });
    return report;
  });
}
