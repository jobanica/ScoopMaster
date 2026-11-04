import { prisma } from "@/lib/db";
import { fmtDate, todayDate, addDays } from "@/lib/dates";
import { UOM_LABEL } from "@/lib/units";
import { optStr, amount, date } from "@/lib/form";
import { AppError } from "@/lib/errors";
import { countFormData, partnerPricing, type CountReportInput, type SalesReportInput } from "./services/sales";
import { contractOn } from "./services/partners";

/** Loads everything the sales form needs for a partner (optionally prefilled from an existing editable report). */
export async function salesFormData(partnerId: string, reportId?: string) {
  const contract = await contractOn(prisma, partnerId, todayDate());
  const pricing = await partnerPricing(prisma, partnerId, contract?.cogsBasis ?? "TRANSFER_PRICE");
  const assignments = await prisma.machineAssignment.findMany({ where: { partnerId, OR: [{ endDate: null }, { endDate: { gte: addDays(todayDate(), -31) } }] }, include: { machine: true } });
  const machines = [...new Map(assignments.map((a) => [a.machineId, { id: a.machineId, code: a.machine.code }])).values()];
  const items = await prisma.inventoryItem.findMany({ where: { isActive: true, category: { in: ["ICE_CREAM_POWDER", "CONES", "CUPS"] } }, orderBy: { name: "asc" } });
  const report = reportId ? await prisma.salesReport.findUnique({ where: { id: reportId }, include: { lines: true, stockLines: true } }) : null;
  if (report && (report.partnerId !== partnerId || !["DRAFT", "REJECTED"].includes(report.status))) throw new AppError("This report cannot be edited.", 403);
  return {
    report,
    products: pricing.map((p) => ({ id: p.product.id, code: p.product.code, name: p.product.name, price: p.price.toString() })),
    machines,
    items: items.map((i) => ({ id: i.id, name: i.name, uom: UOM_LABEL[i.uom] })),
    initial: {
      reportDate: fmtDate(report?.reportDate ?? todayDate()),
      machineId: report?.machineId ?? null,
      discounts: report ? report.discounts.toString() : "", refunds: report ? report.refunds.toString() : "",
      reportedTotal: report ? report.reportedTotal.toString() : "", cashSales: report ? report.cashSales.toString() : "",
      gcashSales: report ? report.gcashSales.toString() : "", otherSales: report ? report.otherSales.toString() : "",
      actualCash: report ? report.actualCash.toString() : "", notes: report?.notes ?? "",
      lines: Object.fromEntries((report?.lines ?? []).map((l) => [l.productId, { quantity: l.quantity, wastageQty: l.wastageQty }])),
      stock: Object.fromEntries((report?.stockLines ?? []).map((s) => [s.itemId, { opening: s.opening.toString(), received: s.received.toString(), closing: s.closing.toString() }])),
    },
  };
}

export function parseSalesForm(fd: FormData, partnerId: string): SalesReportInput {
  const productIds = fd.getAll("productId").map(String);
  const toInt = (v: FormDataEntryValue | null) => {
    const s = String(v ?? "").trim();
    if (!s) return 0;
    if (!/^\d+$/.test(s)) throw new AppError("Quantities must be whole numbers.");
    return Number(s);
  };
  return {
    partnerId,
    machineId: optStr(fd, "machineId"),
    reportDate: date(fd, "reportDate", "Reporting date"),
    lines: productIds.map((id) => ({ productId: id, quantity: toInt(fd.get(`qty_${id}`)), wastageQty: toInt(fd.get(`waste_${id}`)) })),
    discounts: amount(fd, "discounts", "Discounts", { optional: true }),
    refunds: amount(fd, "refunds", "Refunds", { optional: true }),
    reportedTotal: optStr(fd, "reportedTotal") ? amount(fd, "reportedTotal", "Declared total") : null,
    cashSales: amount(fd, "cashSales", "Cash sales", { optional: true }),
    gcashSales: amount(fd, "gcashSales", "GCash sales", { optional: true }),
    otherSales: amount(fd, "otherSales", "Other payments", { optional: true }),
    actualCash: optStr(fd, "actualCash") ? amount(fd, "actualCash", "Actual cash") : null,
    notes: optStr(fd, "notes"),
    stockLines: fd.getAll("stockItemId").map(String).map((id) => ({
      itemId: id,
      opening: optStr(fd, `opening_${id}`) ? amount(fd, `opening_${id}`, "Opening") : "",
      received: optStr(fd, `received_${id}`) ? amount(fd, `received_${id}`, "Received") : "",
      closing: optStr(fd, `closing_${id}`) ? amount(fd, `closing_${id}`, "Closing") : "",
    })),
  };
}

export const intentSubmit = (fd: FormData) => String(fd.get("intent") ?? "draft") === "submit";

/** Data for the closing-count form (INVENTORY_COUNT partners). */
export async function countFormProps(partnerId: string, date: Date) {
  const data = await countFormData(prisma, partnerId, date);
  const report = await prisma.salesReport.findFirst({ where: { partnerId, reportDate: date }, include: { stockLines: true } });
  const missing = data.shift ? await prisma.shiftLine.findMany({ where: { shiftId: data.shift.id, treatedAsSold: true } }) : [];
  const driverOf = new Map(data.drivers.filter((d) => d.product).map((d) => [d.item.id, d.product!]));
  return {
    report,
    shift: data.shift,
    reportingMethod: data.contract?.reportingMethod ?? "THEORETICAL",
    ownerPct: data.contract?.ownerSharePct.toString() ?? "50",
    needsMapping: data.drivers.filter((d) => !d.product && (d.inUse || d.candidates.length > 1)).map((d) => d.item.name),
    rows: data.rows.map((r) => {
      const prod = driverOf.get(r.item.id);
      return { itemId: r.item.id, name: r.item.name, uom: UOM_LABEL[r.item.uom], expected: r.expected.toString(), opening: r.opening.toString(), received: r.received.toString(), missingAtOpening: missing.find((m) => m.itemId === r.item.id)?.variance.abs().toString(), unitValue: r.unitValue.toString(), isContainer: r.isContainer, required: r.required, productId: prod?.id, productName: prod?.name, price: prod ? (data.pricing.find((p) => p.product.id === prod.id)?.price ?? prod.defaultPrice).toString() : undefined };
    }),
    consumption: Object.fromEntries(data.pricing.map((p) => [p.product.id, Object.fromEntries([...p.consumption.entries()].map(([k, v]) => [k, v.toString()]))])),
    initial: {
      closing: Object.fromEntries((report?.stockLines ?? []).filter((s) => s.counted).map((s) => [s.itemId, s.closing.toString()])),
      wasted: Object.fromEntries((report?.stockLines ?? []).filter((s) => Number(s.wasted) > 0).map((s) => [s.itemId, s.wasted.toString()])),
      cashSales: report ? report.cashSales.toString() : "", gcashSales: report ? report.gcashSales.toString() : "", otherSales: report ? report.otherSales.toString() : "",
      actualCash: report ? report.actualCash.toString() : "", discounts: report ? report.discounts.toString() : "", refunds: report ? report.refunds.toString() : "", notes: report?.notes ?? "",
    },
  };
}

export function parseCountForm(fd: FormData, partnerId: string): CountReportInput {
  const num = (k: string, label: string) => (optStr(fd, k) ? amount(fd, k, label) : null);
  return {
    partnerId,
    reportDate: date(fd, "reportDate", "Reporting date"),
    counts: fd.getAll("countItemId").map(String).map((id) => ({ itemId: id, closing: num(`closing_${id}`, "Count"), wasted: num(`wasted_${id}`, "Wasted") })),
    discounts: amount(fd, "discounts", "Discounts", { optional: true }),
    refunds: amount(fd, "refunds", "Refunds", { optional: true }),
    cashSales: amount(fd, "cashSales", "Cash", { optional: true }),
    gcashSales: amount(fd, "gcashSales", "GCash", { optional: true }),
    otherSales: amount(fd, "otherSales", "Other payments", { optional: true }),
    actualCash: optStr(fd, "actualCash") ? amount(fd, "actualCash", "Cash counted") : null,
    notes: optStr(fd, "notes"),
  };
}
