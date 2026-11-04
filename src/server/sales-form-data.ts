import { prisma } from "@/lib/db";
import { fmtDate, todayDate, addDays } from "@/lib/dates";
import { UOM_LABEL } from "@/lib/units";
import { optStr, amount, date } from "@/lib/form";
import { AppError } from "@/lib/errors";
import { partnerPricing, type SalesReportInput } from "./services/sales";
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
