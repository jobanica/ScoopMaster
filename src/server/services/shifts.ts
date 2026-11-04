import type { MovementType } from "@prisma/client";
import { prisma, withTx, type Tx } from "@/lib/db";
import { nextCode } from "@/lib/sequence";
import { audit } from "@/lib/audit";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { D, qty, Decimal } from "@/lib/money";
import { addDays, fmtDate, manilaDayStart, todayDate } from "@/lib/dates";
import type { Actor } from "../actor";
import { ensurePartnerLocation, postMovement } from "./inventory";
import { assertPeriodOpen } from "./periods";
import { contractOn } from "./partners";
import { notify } from "./notifications";

/** Movement types that bring stock INTO a partner location (deliveries, returns, receipts). */
export const INFLOW_TYPES: MovementType[] = ["TRANSFER_IN", "RETURN_IN", "RECEIPT"];
const TRACKED = ["ICE_CREAM_POWDER", "CONES", "CUPS"] as const;

/** Closing time of a business date (20:00 Manila) — counts are recorded at this instant. */
export function closingInstant(date: Date) {
  return new Date(manilaDayStart(date).getTime() + 20 * 3600000);
}

export async function openShiftFor(db: Tx | typeof prisma, partnerId: string, before?: Date) {
  return db.shift.findFirst({ where: { partnerId, status: "OPEN", ...(before ? { businessDate: { lt: before } } : {}) }, orderBy: { businessDate: "asc" } });
}

/**
 * What the partner should have at the start of a shift:
 *   carried over = previous closing count + deliveries since (= stock per records right now)
 */
export async function shiftOpeningData(db: Tx | typeof prisma, partnerId: string) {
  const loc = await db.location.findUnique({ where: { partnerId } });
  const items = await db.inventoryItem.findMany({ where: { isActive: true }, orderBy: [{ category: "asc" }, { name: "asc" }] });
  const levels = loc ? await db.stockLevel.findMany({ where: { locationId: loc.id } }) : [];
  const last = await db.salesReport.findFirst({ where: { partnerId, method: "INVENTORY_COUNT", status: { in: ["SUBMITTED", "APPROVED"] } }, orderBy: { reportDate: "desc" }, include: { stockLines: true } });
  const since = last ? closingInstant(last.reportDate) : null;
  const inflows = loc && since ? await db.stockMovement.groupBy({ by: ["itemId"], where: { locationId: loc.id, type: { in: INFLOW_TYPES }, occurredAt: { gt: since } }, _sum: { quantity: true } }) : [];
  const rows = items
    .filter((i) => (TRACKED as readonly string[]).includes(i.category) || levels.some((l) => l.itemId === i.id && D(l.quantity).gt(0)))
    .map((i) => {
      const balance = qty(levels.find((l) => l.itemId === i.id)?.quantity ?? 0);
      const lastLine = last?.stockLines.find((s) => s.itemId === i.id);
      const received = qty(inflows.find((x) => x.itemId === i.id)?._sum.quantity ?? 0);
      return { item: i, lastClosing: lastLine ? D(lastLine.closing) : null, receivedSince: last ? received : new Decimal(0), carriedOver: balance, required: (TRACKED as readonly string[]).includes(i.category) };
    })
    .filter((r) => r.required || r.carriedOver.gt(0));
  return { rows, lastReport: last ? { id: last.id, number: last.number, reportDate: last.reportDate } : null };
}

export async function openShift(actor: Actor, input: { partnerId: string; counts: { itemId: string; counted: string | null }[]; notes?: string | null }) {
  const partnerId = actor.role === "PARTNER" ? actor.partnerId : input.partnerId;
  if (!partnerId) throw new ForbiddenError();
  const today = todayDate();
  return withTx(async (tx) => {
    const partner = await tx.partner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new NotFoundError("Partner");
    if (!["ACTIVE", "ON_HOLD"].includes(partner.status)) throw new AppError("Only active partners can open a shift.");
    const contract = await contractOn(tx, partnerId, today);
    if (contract?.reportingMethod !== "INVENTORY_COUNT") throw new AppError("Shifts are used with closing-count reporting.");
    await assertPeriodOpen(tx, partnerId, today);
    const existing = await tx.shift.findUnique({ where: { partnerId_businessDate: { partnerId, businessDate: today } } });
    if (existing) throw new AppError(existing.status === "OPEN" ? "Today's shift is already open." : "Today's shift is already closed.");
    const earlier = await openShiftFor(tx, partnerId, today);
    if (earlier) throw new AppError(`The shift for ${fmtDate(earlier.businessDate)} is still open. Submit its closing count first.`);
    const done = await tx.salesReport.findFirst({ where: { partnerId, reportDate: today, status: { in: ["SUBMITTED", "APPROVED"] } } });
    if (done) throw new AppError("Today's closing count was already submitted.");

    const data = await shiftOpeningData(tx, partnerId);
    const countBy = new Map(input.counts.map((c) => [c.itemId, c.counted]));
    const shift = await tx.shift.create({ data: { number: await nextCode(tx, "SH", 7), partnerId, businessDate: today, openedById: actor.id, notes: input.notes } });
    const loc = await ensurePartnerLocation(tx, partnerId);
    const differences: string[] = [];
    for (const r of data.rows) {
      const raw = countBy.get(r.item.id);
      const counted = raw === null || raw === undefined || raw === "" ? null : qty(raw);
      if (counted && counted.isNegative()) throw new AppError(`${r.item.name}: count cannot be negative.`);
      if (counted && ["CONES", "CUPS"].includes(r.item.category) && !counted.isInteger()) throw new AppError(`${r.item.name} must be counted in whole pieces.`);
      const variance = counted ? counted.minus(r.carriedOver) : new Decimal(0);
      // Missing cones/cups are NOT written off: the records keep the carried-over amount, so tonight's closing
      // count derives them as sold (the partner owes the sale). Other differences are posted as a count variance.
      const asSold = variance.isNegative() && ["CONES", "CUPS"].includes(r.item.category);
      await tx.shiftLine.create({ data: { shiftId: shift.id, itemId: r.item.id, lastClosing: r.lastClosing?.toString() ?? null, receivedSince: r.receivedSince.toString(), carriedOver: r.carriedOver.toString(), counted: counted?.toString() ?? null, variance: variance.toString(), treatedAsSold: asSold } });
      if (variance.isZero()) continue;
      if (asSold) {
        differences.push(`${r.item.name} ${variance.toString()} (will be counted as sold)`);
      } else {
        await postMovement(tx, { type: "COUNT_VARIANCE", itemId: r.item.id, locationId: loc.id, quantity: variance, sourceType: "Shift", sourceId: shift.id, reason: `Opening count ${shift.number}: counted ${counted} vs ${r.carriedOver} carried over`, userId: actor.id });
        differences.push(`${r.item.name} ${variance.isNegative() ? "" : "+"}${variance.toString()}`);
      }
    }
    if (differences.length) {
      await tx.shift.update({ where: { id: shift.id }, data: { hasDiscrepancy: true } });
      await notify("SHIFT_VARIANCE", { title: `${partner.businessName}: opening stock differs from last closing`, body: `${differences.join(", ")} (${shift.number})`, link: `/sales/shifts?date=${fmtDate(today)}`, severity: "WARNING", dedupeKey: `shiftvar-${shift.id}` }, tx);
    }
    await audit(tx, { userId: actor.id, action: "SHIFT_OPEN", entityType: "Shift", entityId: shift.id, summary: differences.length ? `Opening differences: ${differences.join(", ")}` : "Opening stock confirmed", after: { counts: input.counts } });
    return shift;
  });
}

/** Called when a closing count is submitted: closes the day's shift (or records one if the partner never opened it). */
export async function closeShiftWithReport(tx: Tx, actor: Actor, report: { id: string; partnerId: string; reportDate: Date }, openingLines: { itemId: string; opening: Decimal }[]) {
  const shift = await tx.shift.findUnique({ where: { partnerId_businessDate: { partnerId: report.partnerId, businessDate: report.reportDate } } });
  if (shift) {
    await tx.shift.update({ where: { id: shift.id }, data: { status: "CLOSED", closedAt: new Date(), reportId: report.id } });
    await audit(tx, { userId: actor.id, action: "SHIFT_CLOSE", entityType: "Shift", entityId: shift.id, summary: `Closed by ${report.id}` });
    return;
  }
  const s = await tx.shift.create({
    data: {
      number: await nextCode(tx, "SH", 7), partnerId: report.partnerId, businessDate: report.reportDate, status: "CLOSED", autoOpened: true, openedById: actor.id, closedAt: new Date(), reportId: report.id,
      notes: "Shift was not opened; recorded at closing.",
      lines: { create: openingLines.map((l) => ({ itemId: l.itemId, carriedOver: l.opening.toString() })) },
    },
  });
  await audit(tx, { userId: actor.id, action: "SHIFT_CLOSE", entityType: "Shift", entityId: s.id, summary: "Recorded at closing (shift not opened)" });
}

export async function reopenShiftForReport(tx: Tx, reportId: string) {
  await tx.shift.updateMany({ where: { reportId }, data: { status: "OPEN", closedAt: null, reportId: null } });
}

/** Staff monitoring: every count-reporting partner and the state of their shift on a date. */
export async function shiftBoard(date: Date) {
  const partners = await prisma.partner.findMany({ where: { status: { in: ["ACTIVE", "ON_HOLD"] } }, include: { contracts: true }, orderBy: { businessName: "asc" } });
  const countPartners = partners.filter((p) => {
    const c = p.contracts.filter((x) => x.effectiveFrom <= date && (!x.effectiveTo || x.effectiveTo >= date)).sort((a, b) => b.version - a.version)[0];
    return c?.reportingMethod === "INVENTORY_COUNT";
  });
  const shifts = await prisma.shift.findMany({ where: { businessDate: date, partnerId: { in: countPartners.map((p) => p.id) } }, include: { lines: { include: { item: true } }, report: true } });
  const reports = await prisma.salesReport.findMany({ where: { reportDate: date, partnerId: { in: countPartners.map((p) => p.id) }, status: { not: "DRAFT" } } });
  return countPartners.map((p) => {
    const shift = shifts.find((s) => s.partnerId === p.id) ?? null;
    return { partner: p, shift, report: shift?.report ?? reports.find((r) => r.partnerId === p.id) ?? null };
  });
}

export { addDays };
