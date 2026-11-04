import type { MovementType, SettlementFrequency } from "@prisma/client";
import { prisma, withTx, type Tx } from "@/lib/db";
import { nextCode } from "@/lib/sequence";
import { audit } from "@/lib/audit";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { D, money, Decimal } from "@/lib/money";
import { computeSettlement } from "@/lib/calc/settlement";
import { addDays, endOfMonth, fmtDate, manilaDayStart, todayDate, ymd } from "@/lib/dates";
import { can } from "@/lib/rbac";
import type { Actor } from "../actor";
import { contractOn } from "./partners";
import { createBill, createInvoice } from "./finance";
import { notify, notifyPartner } from "./notifications";

/** Ledger movement types at a partner location that represent supplies used up (COGS) for the partnership. */
export const COGS_MOVEMENT_TYPES: MovementType[] = ["CONSUMPTION", "WASTAGE", "DAMAGED", "EXPIRED", "COUNT_VARIANCE", "ADJUSTMENT", "ISSUE", "REVERSAL"];

export async function gatherSettlementData(db: Tx | typeof prisma, partnerId: string, periodStart: Date, periodEnd: Date, settlementId?: string) {
  if (periodEnd < periodStart) throw new AppError("Period end must be on or after period start.");
  const contract = await contractOn(db, partnerId, periodEnd);
  if (!contract) throw new AppError(`No partnership contract is in force on ${fmtDate(periodEnd)}.`);
  const startContract = await contractOn(db, partnerId, periodStart);
  if (!startContract || startContract.id !== contract.id) {
    throw new AppError("The contract changes within this period. Settle each contract version separately (split the period at the contract start date).");
  }

  const reports = await db.salesReport.findMany({
    where: { partnerId, reportDate: { gte: periodStart, lte: periodEnd }, status: "APPROVED", OR: [{ settlementId: null }, ...(settlementId ? [{ settlementId }] : [])] },
    orderBy: { reportDate: "asc" },
    select: { id: true, number: true, reportDate: true, grossSales: true, discounts: true, refunds: true, netSales: true, machineId: true },
  });
  const alreadySettled = await db.salesReport.count({ where: { partnerId, reportDate: { gte: periodStart, lte: periodEnd }, status: "APPROVED", settlementId: { not: null, ...(settlementId ? { notIn: [settlementId] } : {}) } } });
  const pendingReports = await db.salesReport.count({ where: { partnerId, reportDate: { gte: periodStart, lte: periodEnd }, status: { in: ["DRAFT", "SUBMITTED", "REJECTED"] } } });
  const expenses = await db.partnerExpense.findMany({
    where: { partnerId, expenseDate: { gte: periodStart, lte: periodEnd }, status: "APPROVED", OR: [{ settlementId: null }, ...(settlementId ? [{ settlementId }] : [])] },
    orderBy: { expenseDate: "asc" },
  });
  const pendingExpenses = await db.partnerExpense.count({ where: { partnerId, expenseDate: { gte: periodStart, lte: periodEnd }, status: "PENDING" } });

  const location = await db.location.findUnique({ where: { partnerId } });
  const movements = location
    ? await db.stockMovement.findMany({
        where: { locationId: location.id, type: { in: COGS_MOVEMENT_TYPES }, occurredAt: { gte: manilaDayStart(periodStart), lt: manilaDayStart(addDays(periodEnd, 1)) } },
        include: { item: { select: { sku: true, name: true, uom: true } } },
      })
    : [];
  const basisPrice = (m: (typeof movements)[number]) => D(contract.cogsBasis === "OWNER_COST" ? m.unitCost : m.unitPrice);
  const byItem = new Map<string, { sku: string; name: string; uom: string; quantity: Decimal; value: Decimal; byType: Record<string, string> }>();
  let supplies = new Decimal(0);
  for (const m of movements) {
    const used = D(m.quantity).negated(); // outflows are negative quantities → positive usage
    const value = used.times(basisPrice(m));
    supplies = supplies.plus(value);
    const row = byItem.get(m.itemId) ?? { sku: m.item.sku, name: m.item.name, uom: m.item.uom, quantity: new Decimal(0), value: new Decimal(0), byType: {} };
    row.quantity = row.quantity.plus(used);
    row.value = row.value.plus(value);
    row.byType[m.type] = D(row.byType[m.type] ?? 0).plus(used).toString();
    byItem.set(m.itemId, row);
  }

  const gross = reports.reduce((a, r) => a.plus(D(r.grossSales)), new Decimal(0));
  const discounts = reports.reduce((a, r) => a.plus(D(r.discounts)), new Decimal(0));
  const refunds = reports.reduce((a, r) => a.plus(D(r.refunds)), new Decimal(0));
  const result = computeSettlement({
    terms: contract,
    grossSales: gross, discounts, refunds, suppliesConsumed: money(supplies),
    expenses: expenses.map((e) => ({ amount: e.amount, paidBy: e.paidBy })),
  });

  const supplyInvoices = await db.invoice.findMany({ where: { partnerId, type: "SUPPLY", status: { not: "CANCELLED" } }, select: { id: true, number: true, issueDate: true, amount: true, costAmount: true, amountPaid: true } });
  const inPeriod = supplyInvoices.filter((i) => i.issueDate >= periodStart && i.issueDate <= periodEnd);
  const supplyMarkup = inPeriod.reduce((a, i) => a.plus(D(i.amount).minus(D(i.costAmount))), new Decimal(0));
  const supplyOutstanding = supplyInvoices.reduce((a, i) => a.plus(D(i.amount).minus(D(i.amountPaid))), new Decimal(0));

  return {
    contract, reports, expenses, pendingReports, pendingExpenses, alreadySettled, result,
    gross: money(gross), discounts: money(discounts), refunds: money(refunds),
    supplyMarkup: money(supplyMarkup), supplyOutstanding: money(supplyOutstanding),
    calculation: {
      terms: {
        contractVersion: contract.version, shareModel: contract.shareModel, ownerSharePct: contract.ownerSharePct.toString(), partnerSharePct: contract.partnerSharePct.toString(),
        fixedFee: contract.fixedFee.toString(), cogsBasis: contract.cogsBasis, deductOperatingExpenses: contract.deductOperatingExpenses, shareLosses: contract.shareLosses, cashCustody: contract.cashCustody,
      },
      salesReports: reports.map((r) => ({ id: r.id, number: r.number, date: ymd(r.reportDate), gross: r.grossSales.toString(), discounts: r.discounts.toString(), refunds: r.refunds.toString(), net: r.netSales.toString() })),
      expenses: expenses.map((e) => ({ id: e.id, number: e.number, date: ymd(e.expenseDate), description: e.description, amount: e.amount.toString(), paidBy: e.paidBy })),
      supplies: [...byItem.entries()].map(([itemId, r]) => ({ itemId, sku: r.sku, name: r.name, uom: r.uom, quantity: r.quantity.toString(), value: money(r.value).toString(), byType: r.byType })),
      movementCount: movements.length,
      supplyInvoicesInPeriod: inPeriod.map((i) => ({ id: i.id, number: i.number, amount: i.amount.toString(), markup: D(i.amount).minus(D(i.costAmount)).toString() })),
      steps: result.steps,
    },
  };
}

function settlementData(d: Awaited<ReturnType<typeof gatherSettlementData>>) {
  const r = d.result;
  return {
    contractId: d.contract.id,
    grossSales: d.gross.toString(), discounts: d.discounts.toString(), refunds: d.refunds.toString(), netSales: r.netSales.toString(),
    suppliesConsumed: r.suppliesConsumed.toString(), operatingExpenses: r.operatingExpenses.toString(), distributableProfit: r.distributableProfit.toString(),
    fixedFee: r.fixedFee.toString(), ownerShare: r.ownerShare.toString(), partnerShare: r.partnerShare.toString(),
    ownerPaidExpenses: r.ownerPaidExpenses.toString(), partnerPaidExpenses: r.partnerPaidExpenses.toString(), netDueToOwner: r.netDueToOwner.toString(),
    supplyMarkupInPeriod: d.supplyMarkup.toString(), supplyInvoicesOutstanding: d.supplyOutstanding.toString(),
    calculation: d.calculation as object,
  };
}

async function link(tx: Tx, settlementId: string, d: Awaited<ReturnType<typeof gatherSettlementData>>) {
  await tx.salesReport.updateMany({ where: { settlementId }, data: { settlementId: null } });
  await tx.partnerExpense.updateMany({ where: { settlementId }, data: { settlementId: null } });
  if (d.reports.length) await tx.salesReport.updateMany({ where: { id: { in: d.reports.map((r) => r.id) } }, data: { settlementId } });
  if (d.expenses.length) await tx.partnerExpense.updateMany({ where: { id: { in: d.expenses.map((e) => e.id) } }, data: { settlementId } });
}

export async function createSettlement(actor: Actor, input: { partnerId: string; periodStart: Date; periodEnd: Date; notes?: string | null }) {
  if (input.periodEnd > todayDate()) throw new AppError("A settlement period cannot end in the future.");
  return withTx(async (tx) => {
    const overlap = await tx.settlement.findFirst({ where: { partnerId: input.partnerId, status: { not: "VOIDED" }, periodStart: { lte: input.periodEnd }, periodEnd: { gte: input.periodStart } } });
    if (overlap) throw new AppError(`Period overlaps settlement ${overlap.number} (${fmtDate(overlap.periodStart)}–${fmtDate(overlap.periodEnd)}).`);
    const d = await gatherSettlementData(tx, input.partnerId, input.periodStart, input.periodEnd);
    const s = await tx.settlement.create({
      data: { number: await nextCode(tx, "STL", 4, { yearly: true }), partnerId: input.partnerId, periodStart: input.periodStart, periodEnd: input.periodEnd, notes: input.notes, preparedById: actor.id, ...settlementData(d) },
    });
    await link(tx, s.id, d);
    await audit(tx, { userId: actor.id, action: "SETTLEMENT_CREATE", entityType: "Settlement", entityId: s.id, after: s });
    return s;
  });
}

export async function recalculateSettlement(actor: Actor, id: string, tx?: Tx) {
  const fn = async (tx: Tx) => {
    const s = await tx.settlement.findUnique({ where: { id } });
    if (!s) throw new NotFoundError("Settlement");
    if (s.status !== "DRAFT") throw new AppError("Only draft settlements can be recalculated.");
    const d = await gatherSettlementData(tx, s.partnerId, s.periodStart, s.periodEnd, s.id);
    const after = await tx.settlement.update({ where: { id }, data: settlementData(d) });
    await link(tx, s.id, d);
    await audit(tx, { userId: actor.id, action: "SETTLEMENT_RECALCULATE", entityType: "Settlement", entityId: id, before: s, after });
    return { settlement: after, data: d };
  };
  return tx ? fn(tx) : withTx(fn);
}

export async function submitSettlement(actor: Actor, id: string) {
  return withTx(async (tx) => {
    const { settlement, data } = await recalculateSettlement(actor, id, tx);
    if (data.pendingReports > 0) throw new AppError(`${data.pendingReports} sales report(s) in this period are not yet approved. Approve or reject them first.`);
    if (data.pendingExpenses > 0) throw new AppError(`${data.pendingExpenses} partner expense(s) in this period are awaiting review.`);
    const after = await tx.settlement.update({ where: { id }, data: { status: "PENDING_APPROVAL", submittedAt: new Date() } });
    await audit(tx, { userId: actor.id, action: "SETTLEMENT_SUBMIT", entityType: "Settlement", entityId: id });
    const p = await tx.partner.findUniqueOrThrow({ where: { id: settlement.partnerId } });
    await notify("SETTLEMENT_READY", { title: `Settlement ${settlement.number} ready for approval`, body: `${p.businessName}: owner share ₱${D(settlement.ownerShare).toFixed(2)}`, link: `/settlements/${id}`, dedupeKey: `stl-ready-${id}-${Date.now()}` }, tx);
    return after;
  });
}

export async function returnSettlementToDraft(actor: Actor, id: string, notes: string) {
  return withTx(async (tx) => {
    const s = await tx.settlement.findUniqueOrThrow({ where: { id } });
    if (s.status !== "PENDING_APPROVAL") throw new AppError("Only settlements pending approval can be returned.");
    await tx.settlement.update({ where: { id }, data: { status: "DRAFT", notes: notes ? `${s.notes ?? ""}\nReturned: ${notes}`.trim() : s.notes } });
    await audit(tx, { userId: actor.id, action: "SETTLEMENT_RETURN", entityType: "Settlement", entityId: id, summary: notes });
  });
}

/** Finalize (approve). Creates the receivable (partner owes owner) or payable (owner owes partner). */
export async function finalizeSettlement(actor: Actor, id: string) {
  if (!can(actor.role, "settlements:approve")) throw new ForbiddenError("Only authorized approvers can finalize settlements.");
  return withTx(async (tx) => {
    const s = await tx.settlement.findUnique({ where: { id }, include: { contract: true, partner: true } });
    if (!s) throw new NotFoundError("Settlement");
    if (s.status !== "PENDING_APPROVAL") throw new AppError("Submit the settlement for approval first.");
    if (s.preparedById === actor.id && actor.role !== "SUPER_ADMIN") throw new ForbiddenError("The person who prepared a settlement cannot approve it.");
    const today = todayDate();
    const due = addDays(today, s.contract.paymentTermsDays);
    const net = D(s.netDueToOwner);
    const period = `${fmtDate(s.periodStart)}–${fmtDate(s.periodEnd)}`;
    if (net.gt(0)) {
      const lines = [{ description: `Owner share of partnership profit (${period})`, quantity: 1, unitPrice: s.ownerShare.toString() }];
      if (D(s.ownerPaidExpenses).gt(0) && s.contract.deductOperatingExpenses) lines.push({ description: "Reimbursement of partnership expenses paid by owner", quantity: 1, unitPrice: s.ownerPaidExpenses.toString() });
      const filtered = lines.every((l) => D(l.unitPrice).gte(0)) ? lines.filter((l) => D(l.unitPrice).gt(0)) : [];
      await createInvoice(actor, {
        type: "PARTNERSHIP_SHARE", partnerId: s.partnerId, description: `Settlement ${s.number} (${period})`, issueDate: today, dueDate: due,
        paymentTerms: `Net ${s.contract.paymentTermsDays} days`, lines: filtered.length ? filtered : [{ description: `Net due per settlement ${s.number}`, quantity: 1, unitPrice: net.toString() }], settlementId: s.id,
      }, tx);
    } else if (net.lt(0)) {
      await createBill(actor, {
        category: "PARTNER_PAYOUT", partnerId: s.partnerId, payeeName: s.partner.businessName, description: `Partner share – settlement ${s.number} (${period})`,
        billDate: today, dueDate: due, amount: net.abs().toString(), paymentTerms: `Net ${s.contract.paymentTermsDays} days`, settlementId: s.id,
      }, tx);
    }
    const after = await tx.settlement.update({ where: { id }, data: { status: "FINALIZED", approvedById: actor.id, finalizedAt: new Date() } });
    await audit(tx, { userId: actor.id, action: "SETTLEMENT_FINALIZE", entityType: "Settlement", entityId: id, after });
    await notifyPartner(s.partnerId, "SETTLEMENT_READY", { title: `Settlement statement ${s.number} is available`, body: `Period ${period}. Your share: ₱${D(s.partnerShare).toFixed(2)}.`, link: `/portal/statements/${s.id}`, dedupeKey: `stl-fin-${s.id}` }, tx);
    return after;
  });
}

export async function voidSettlement(actor: Actor, id: string, reason: string) {
  if (!reason?.trim()) throw new AppError("A reason is required to void a settlement.");
  return withTx(async (tx) => {
    const s = await tx.settlement.findUnique({ where: { id }, include: { invoice: true, bill: true } });
    if (!s) throw new NotFoundError("Settlement");
    if (s.status === "VOIDED") throw new AppError("Already voided.");
    if (s.status === "FINALIZED" && !can(actor.role, "settlements:approve")) throw new ForbiddenError();
    if (s.invoice && D(s.invoice.amountPaid).gt(0)) throw new AppError(`Payments have been applied to ${s.invoice.number}. Void those payments first.`);
    if (s.bill && D(s.bill.amountPaid).gt(0)) throw new AppError(`Payments have been applied to ${s.bill.number}. Void those payments first.`);
    if (s.invoice && s.invoice.status !== "CANCELLED") await tx.invoice.update({ where: { id: s.invoice.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: `Settlement voided: ${reason}` } });
    if (s.bill && s.bill.status !== "CANCELLED") await tx.bill.update({ where: { id: s.bill.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: `Settlement voided: ${reason}` } });
    await tx.salesReport.updateMany({ where: { settlementId: id }, data: { settlementId: null } });
    await tx.partnerExpense.updateMany({ where: { settlementId: id }, data: { settlementId: null } });
    const after = await tx.settlement.update({ where: { id }, data: { status: "VOIDED", voidedAt: new Date(), voidReason: reason } });
    await audit(tx, { userId: actor.id, action: "SETTLEMENT_VOID", entityType: "Settlement", entityId: id, summary: reason, before: s, after });
    return after;
  });
}

/** Proposes the next period per the contract's settlement frequency. */
export async function suggestNextPeriod(partnerId: string) {
  const last = await prisma.settlement.findFirst({ where: { partnerId, status: { not: "VOIDED" } }, orderBy: { periodEnd: "desc" } });
  const today = todayDate();
  const contract = await contractOn(prisma, partnerId, last ? addDays(last.periodEnd, 1) : today);
  const first = await prisma.partnerContract.findFirst({ where: { partnerId }, orderBy: { version: "asc" } });
  const start = last ? addDays(last.periodEnd, 1) : first?.effectiveFrom ?? today;
  const end = periodEndFor(start, contract?.settlementFrequency ?? "MONTHLY");
  const capped = end > today ? today : end;
  return { start, end: capped < start ? start : capped, frequency: contract?.settlementFrequency ?? "MONTHLY" };
}

export function periodEndFor(start: Date, f: SettlementFrequency): Date {
  switch (f) {
    case "DAILY": return start;
    case "WEEKLY": return addDays(start, 6);
    case "SEMI_MONTHLY": return start.getUTCDate() <= 15 ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 15)) : endOfMonth(start);
    case "MONTHLY": return endOfMonth(start);
  }
}

// ───────────── Bulk operations (daily settlements across many partners) ─────────────

async function periodHasData(partnerId: string, start: Date, end: Date) {
  const loc = await prisma.location.findUnique({ where: { partnerId } });
  const [reports, expenses, moves] = await Promise.all([
    prisma.salesReport.count({ where: { partnerId, reportDate: { gte: start, lte: end }, status: { not: "DRAFT" } } }),
    prisma.partnerExpense.count({ where: { partnerId, expenseDate: { gte: start, lte: end }, status: { not: "REJECTED" } } }),
    loc ? prisma.stockMovement.count({ where: { locationId: loc.id, type: { in: COGS_MOVEMENT_TYPES }, occurredAt: { gte: manilaDayStart(start), lt: manilaDayStart(addDays(end, 1)) } } }) : 0,
  ]);
  return reports + expenses + moves > 0;
}

/**
 * Creates (and optionally submits) every settlement that is due per each partner's schedule, up to yesterday.
 * Consecutive periods without any activity are merged into the next period, so closed days don't create empty settlements.
 */
export async function createDueSettlements(actor: Actor, opts: { submit: boolean; partnerId?: string; until?: Date }) {
  const today = todayDate();
  const partners = await prisma.partner.findMany({ where: { status: { in: ["ACTIVE", "ON_HOLD"] }, contracts: { some: {} }, ...(opts.partnerId ? { id: opts.partnerId } : {}) }, orderBy: { businessName: "asc" } });
  const result = { created: 0, submitted: 0, skipped: [] as string[] };
  for (const p of partners) {
    for (let guard = 0; guard < 400; guard++) {
      const last = await prisma.settlement.findFirst({ where: { partnerId: p.id, status: { not: "VOIDED" } }, orderBy: { periodEnd: "desc" } });
      const first = await prisma.partnerContract.findFirst({ where: { partnerId: p.id }, orderBy: { version: "asc" } });
      const start = last ? addDays(last.periodEnd, 1) : first!.effectiveFrom;
      const contract = await contractOn(prisma, p.id, start);
      if (!contract) break;
      const limit = opts.until && opts.until <= today ? opts.until : addDays(today, -1);
      const cap = contract.effectiveTo && contract.effectiveTo < limit ? contract.effectiveTo : limit;
      let end = periodEndFor(start, contract.settlementFrequency);
      if (end > cap) break;
      while (!(await periodHasData(p.id, start, end))) {
        const next = periodEndFor(addDays(end, 1), contract.settlementFrequency);
        if (next > cap) { end = cap; break; }
        end = next;
      }
      if (!(await periodHasData(p.id, start, end))) break;
      const unreviewed = await prisma.salesReport.count({ where: { partnerId: p.id, reportDate: { gte: start, lte: end }, status: { in: ["DRAFT", "SUBMITTED", "REJECTED"] } } });
      if (unreviewed) { result.skipped.push(`${p.businessName}: ${unreviewed} report(s) from ${fmtDate(start)} awaiting review`); break; }
      try {
        const s = await createSettlement(actor, { partnerId: p.id, periodStart: start, periodEnd: end });
        result.created++;
        if (opts.submit) {
          try { await submitSettlement(actor, s.id); result.submitted++; } catch (e) { result.skipped.push(`${p.businessName} ${s.number}: ${(e as Error).message}`); break; }
        }
      } catch (e) {
        result.skipped.push(`${p.businessName}: ${(e as Error).message}`);
        break;
      }
    }
  }
  return result;
}

/** Finalizes every settlement pending approval that this approver did not prepare. */
export async function finalizePendingSettlements(actor: Actor) {
  if (!can(actor.role, "settlements:approve")) throw new ForbiddenError();
  const pending = await prisma.settlement.findMany({ where: { status: "PENDING_APPROVAL", ...(actor.role === "SUPER_ADMIN" ? {} : { NOT: { preparedById: actor.id } }) }, include: { partner: true }, orderBy: { periodEnd: "asc" } });
  const result = { finalized: 0, failed: [] as string[] };
  for (const s of pending) {
    try { await finalizeSettlement(actor, s.id); result.finalized++; } catch (e) { result.failed.push(`${s.number} (${s.partner.businessName}): ${(e as Error).message}`); }
  }
  return result;
}

/** Settlements prepared automatically by the system (no preparer), so an approver can finalize them. */
const SYSTEM: Actor = { id: null as unknown as string, role: "SUPER_ADMIN", partnerId: null, name: "System" };

/**
 * Daily closing-count partners: when a day's count is approved, settle that day straight away so the owner's share is
 * invoiced and the partner can pay it the same evening. Returns a short status for the approver.
 */
export async function autoSettleDailyCount(approver: Actor, report: { partnerId: string; reportDate: Date; method: string }) {
  if (report.method !== "INVENTORY_COUNT" || !can(approver.role, "settlements:approve")) return null;
  const contract = await contractOn(prisma, report.partnerId, report.reportDate);
  if (contract?.settlementFrequency !== "DAILY") return null;
  // re-submit any system drafts that were waiting on reviews
  for (const d of await prisma.settlement.findMany({ where: { partnerId: report.partnerId, status: "DRAFT", preparedById: null } })) {
    try { await submitSettlement(SYSTEM, d.id); } catch { /* still waiting */ }
  }
  const created = await createDueSettlements(SYSTEM, { submit: true, partnerId: report.partnerId, until: report.reportDate });
  let finalized = 0;
  for (const s of await prisma.settlement.findMany({ where: { partnerId: report.partnerId, status: "PENDING_APPROVAL", preparedById: null }, orderBy: { periodEnd: "asc" } })) {
    try { await finalizeSettlement(approver, s.id); finalized++; } catch (e) { created.skipped.push((e as Error).message); }
  }
  return { finalized, notes: created.skipped };
}

/** "Settle this day now" for an approved closing count: submits and finalizes that day's settlement in one step. */
export async function settleReportDay(approver: Actor, reportId: string) {
  if (!can(approver.role, "settlements:approve")) throw new ForbiddenError();
  const r = await prisma.salesReport.findUnique({ where: { id: reportId }, include: { settlement: true } });
  if (!r) throw new NotFoundError("Sales report");
  if (r.status !== "APPROVED") throw new AppError("Approve the report first.");
  let s = r.settlement;
  if (!s) {
    const res = await autoSettleDailyCount(approver, r);
    if (res?.finalized) return "settled";
    s = (await prisma.salesReport.findUniqueOrThrow({ where: { id: reportId }, include: { settlement: true } })).settlement;
    if (!s) throw new AppError(res?.notes?.[0] ?? "No settlement could be created for this day (is the contract on a daily schedule?).");
  }
  if (s.status === "FINALIZED") return "already settled";
  if (s.status === "DRAFT") await submitSettlement(approver, s.id);
  await finalizeSettlement(approver, s.id);
  return "settled";
}
