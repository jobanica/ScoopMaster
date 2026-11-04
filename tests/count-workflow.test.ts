import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { D } from "@/lib/money";
import { addDays, manilaDayStart, todayDate } from "@/lib/dates";
import { resetDb, makeStaff } from "./helpers";
import type { Actor } from "@/server/actor";
import { saveItem, saveRecipe, saveProduct } from "@/server/services/catalog";
import { receiveStock } from "@/server/services/inventory";
import { createPartner, createContract, changePartnerStatus, createUser } from "@/server/services/partners";
import { createMachine, assignMachine } from "@/server/services/machines";
import { createSupplyRequest, reviewSupplyOrder, dispatchSupplyOrder, confirmSupplyReceipt } from "@/server/services/supply";
import { saveCountReport, approveSalesReport, requestSalesEdit, reviewSalesEdit } from "@/server/services/sales";
import { createDueSettlements, finalizePendingSettlements } from "@/server/services/settlements";
import { openShift, shiftOpeningData } from "@/server/services/shifts";
import { reopenSalesReport } from "@/server/services/sales";

let admin: Actor, finance: Actor, partner: Actor;
let ids: Record<string, string> = {};
const today = todayDate();
const day2 = addDays(today, -2);
const day1 = addDays(today, -1);
const level = async (itemId: string) => D((await prisma.stockLevel.findFirst({ where: { itemId, location: { partnerId: partner.partnerId! } } }))?.quantity).toString();
const counts = (c: Record<string, string | null>, w: Record<string, string> = {}) => Object.entries(c).map(([k, v]) => ({ itemId: ids[k], closing: v, wasted: w[k] ?? null }));
const money0 = { discounts: "0", refunds: "0", otherSales: "0" };

beforeAll(async () => {
  await resetDb();
  admin = await makeStaff("ADMIN", "a@t.local");
  finance = await makeStaff("FINANCE", "f@t.local");
  const wh = await makeStaff("WAREHOUSE", "w@t.local");
  const item = (sku: string, name: string, category: "ICE_CREAM_POWDER" | "CONES" | "CUPS" | "SPOONS", uom: "KG" | "PC", cost: string, price: string) =>
    saveItem(admin, { sku, name, category, uom, purchaseCost: cost, partnerPrice: price, minStock: "0", partnerMinStock: "0", isPerishable: false, isSellable: true, isActive: true });
  ids.powder = (await item("P", "Powder", "ICE_CREAM_POWDER", "KG", "300", "400")).id;
  ids.cone = (await item("C", "Cones", "CONES", "PC", "1.5", "2")).id;
  ids.cup = (await item("U", "Cups", "CUPS", "PC", "2", "2.5")).id;
  ids.spoon = (await item("S", "Spoons", "SPOONS", "PC", "0.3", "0.5")).id;
  for (const [k, q] of [["powder", "20"], ["cone", "1000"], ["cup", "500"], ["spoon", "500"]] as const) await receiveStock(wh, { itemId: ids[k], quantity: q, unitCost: k === "powder" ? "300" : "1" });
  const r = await saveRecipe(admin, { code: "V", name: "Vanilla", yieldGrams: "3700", wastagePct: "5", isActive: true, ingredients: [{ itemId: ids.powder, name: "", quantity: "1", uom: "KG" }, { itemId: null, name: "Water", quantity: "2.7", uom: "L", unitCost: "0" }] });
  ids.coneP = (await saveProduct(admin, { code: "C80", name: "Cone 80g", type: "CONE", recipeId: r.id, servingGrams: "80", defaultPrice: "25", isActive: true, components: [{ itemId: ids.cone, quantity: "1", uom: "PC" }] })).id;
  ids.cupP = (await saveProduct(admin, { code: "U100", name: "Cup 100g", type: "CUP", recipeId: r.id, servingGrams: "100", defaultPrice: "35", isActive: true, components: [{ itemId: ids.cup, quantity: "1", uom: "PC" }, { itemId: ids.spoon, quantity: "1", uom: "PC" }] })).id;
  const p = await createPartner(admin, { businessName: "Count Store", ownerName: "Owner" });
  await changePartnerStatus(admin, p.id, "PENDING_APPROVAL", "x");
  await createContract(admin, p.id, { effectiveFrom: addDays(today, -5), shareModel: "PROFIT_SHARE", ownerSharePct: "50", fixedFee: "0", cogsBasis: "TRANSFER_PRICE", deductOperatingExpenses: false, shareLosses: true, cashCustody: "PARTNER", settlementFrequency: "DAILY", reportingMethod: "INVENTORY_COUNT", paymentTermsDays: 1, supplyPaymentTermsDays: 15 });
  await changePartnerStatus(admin, p.id, "ACTIVE", "x");
  const m = await createMachine(admin, { brand: "B", model: "M", nozzles: 1, serialNumber: "S1", purchasePrice: "50000", condition: "NEW" });
  await assignMachine(admin, m.id, p.id, addDays(today, -5), "deploy");
  const u = await createUser(admin, { email: "p@t.local", name: "P", password: "PartnerPass123", role: "PARTNER", partnerId: p.id });
  partner = { id: u.id, role: "PARTNER", partnerId: p.id };
  const so = await createSupplyRequest(partner, { partnerId: p.id, lines: [{ itemId: ids.powder, quantity: "4" }, { itemId: ids.cone, quantity: "300" }, { itemId: ids.cup, quantity: "100" }, { itemId: ids.spoon, quantity: "100" }] });
  await reviewSupplyOrder(admin, so.id, { approve: true });
  await dispatchSupplyOrder(wh, so.id);
  await confirmSupplyReceipt(partner, so.id, { receivedQty: {} });
  await prisma.stockMovement.updateMany({ where: { sourceType: "SupplyOrder", sourceId: so.id }, data: { occurredAt: manilaDayStart(addDays(today, -3)) } });
});
afterAll(async () => prisma.$disconnect());

describe("inventory-count reporting workflow", () => {
  it("derives sales and gross profit from the closing count and posts actual usage", async () => {
    const r = await saveCountReport(partner, { partnerId: "ignored", reportDate: day2, counts: counts({ cone: "250", cup: "90", powder: "2.9", spoon: null }, { cone: "2" }), ...money0, cashSales: "1550", gcashSales: "0" }, { submit: true });
    expect(r.method).toBe("INVENTORY_COUNT");
    expect(r.totalUnits).toBe(58); // 48 cones + 10 cups
    expect(D(r.netSales).toFixed(2)).toBe("1550.00");
    // cost at partner prices: cones 50×2=100, cups 10×2.5=25, powder 1.1×400=440, spoons (estimated 10)×0.5=5
    expect(D(r.estimatedCogs).toFixed(2)).toBe("570.00");
    expect(D(r.estimatedProfit).toFixed(2)).toBe("980.00");
    expect(r.hasDiscrepancy).toBe(false);
    expect(await level(ids.cone)).toBe("250");
    expect(await level(ids.powder)).toBe("2.9");
    expect(await level(ids.spoon)).toBe("90");
  });

  it("flags powder use that the counted cones/cups do not explain", async () => {
    const r = await saveCountReport(partner, { partnerId: "x", reportDate: day1, counts: counts({ cone: "200", cup: "85", powder: "1", spoon: "85" }), ...money0, cashSales: "1425", gcashSales: "0" }, { submit: true });
    expect(r.totalUnits).toBe(55);
    expect(r.hasDiscrepancy).toBe(true);
    expect(r.discrepancyNotes).toMatch(/Powder used/);
    expect(D(r.powderVariancePct).gt(50)).toBe(true);
  });

  it("enforces date order and protects counts that later counts depend on", async () => {
    await expect(saveCountReport(partner, { partnerId: "x", reportDate: addDays(today, -3), counts: counts({ cone: "300", cup: "100", powder: "4" }), ...money0, cashSales: "0", gcashSales: "0" }, { submit: true })).rejects.toThrow(/date order/);
    const r2 = await prisma.salesReport.findFirstOrThrow({ where: { reportDate: day2 } });
    const req = await requestSalesEdit(partner, r2.id, "typo");
    await expect(reviewSalesEdit(admin, req.id, true)).rejects.toThrow(/later count/);
    await expect(saveCountReport(partner, { partnerId: "x", reportDate: today, counts: counts({ cone: "201", cup: "85", powder: "1" }), ...money0, cashSales: "0", gcashSales: "0" }, { submit: true })).rejects.toThrow(/expected on hand|should be on hand/);
  });

  it("creates daily settlements in bulk and splits each day's gross profit 50/50", async () => {
    for (const r of await prisma.salesReport.findMany({ where: { status: "SUBMITTED" } })) await approveSalesReport(admin, r.id);
    const res = await createDueSettlements(finance, { submit: true });
    expect(res.created).toBe(2);
    expect(res.submitted).toBe(2);
    const fin = await finalizePendingSettlements(admin);
    expect(fin.finalized).toBe(2);
    const settlements = await prisma.settlement.findMany({ orderBy: { periodEnd: "asc" }, include: { invoice: true, salesReports: true } });
    for (const s of settlements) {
      const report = s.salesReports[0];
      // the settlement's supplies consumed equals the cost on the daily count — no double counting
      expect(D(s.suppliesConsumed).toFixed(2)).toBe(D(report.estimatedCogs).toFixed(2));
      expect(D(s.distributableProfit).toFixed(2)).toBe(D(report.estimatedProfit).toFixed(2));
      expect(D(s.ownerShare).toFixed(2)).toBe(D(report.estimatedProfit).dividedBy(2).toDecimalPlaces(2).toFixed(2));
      expect(s.invoice?.type).toBe("PARTNERSHIP_SHARE");
    }
    expect(D(settlements[0].ownerShare).toFixed(2)).toBe("490.00");
    // empty days before the first count were merged into the first settlement
    expect(settlements[0].periodStart.toISOString().slice(0, 10)).toBe(addDays(today, -5).toISOString().slice(0, 10));
  });

  it("open shift carries over yesterday's closing; differences are recorded; closing count closes the shift", async () => {
    // counts submitted without opening a shift were recorded as shifts at closing
    const auto = await prisma.shift.findMany({ where: { partnerId: partner.partnerId! }, orderBy: { businessDate: "asc" } });
    expect(auto.map((x) => [x.status, x.autoOpened])).toEqual([["CLOSED", true], ["CLOSED", true]]);

    const opening = await shiftOpeningData(prisma, partner.partnerId!);
    const cone = opening.rows.find((r) => r.item.id === ids.cone)!;
    expect(cone.lastClosing!.toString()).toBe("200"); // yesterday's closing count
    expect(cone.receivedSince.toString()).toBe("0");
    expect(cone.carriedOver.toString()).toBe("200");
    expect(opening.rows.find((r) => r.item.id === ids.powder)!.carriedOver.toString()).toBe("1");

    // the partner finds only 198 cones in the morning
    const shift = await openShift(partner, { partnerId: "ignored", counts: [{ itemId: ids.cone, counted: "198" }, { itemId: ids.cup, counted: null }] });
    expect(shift.businessDate.toISOString().slice(0, 10)).toBe(today.toISOString().slice(0, 10));
    expect(await level(ids.cone)).toBe("198");
    const s1 = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id }, include: { lines: true } });
    expect(s1.hasDiscrepancy).toBe(true);
    expect(s1.lines.find((l) => l.itemId === ids.cone)!.variance.toString()).toBe("-2");
    expect(await prisma.notification.count({ where: { type: "SHIFT_VARIANCE" } })).toBeGreaterThan(0);
    await expect(openShift(partner, { partnerId: "x", counts: [] })).rejects.toThrow(/already open/);

    // closing: 198 opening → 150 left = 48 cones sold
    const r = await saveCountReport(partner, { partnerId: "x", reportDate: today, counts: counts({ cone: "150", cup: "85", powder: "0.05", spoon: "85" }), ...money0, cashSales: "1200", gcashSales: "0" }, { submit: true });
    expect(r.totalUnits).toBe(48);
    const line = await prisma.salesReportStock.findFirstOrThrow({ where: { reportId: r.id, itemId: ids.cone } });
    expect(line.opening.toString()).toBe("198");
    const closed = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(closed.status).toBe("CLOSED");
    expect(closed.reportId).toBe(r.id);

    // reopening the count reopens the shift
    await reopenSalesReport(admin, r.id, "recount");
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).status).toBe("OPEN");
  });

  it("a shift left open blocks the next one", async () => {
    const y = await prisma.shift.findFirstOrThrow({ where: { businessDate: day1 } });
    const t = await prisma.shift.findFirstOrThrow({ where: { businessDate: today } });
    await prisma.shift.delete({ where: { id: t.id } });
    await prisma.shift.update({ where: { id: y.id }, data: { status: "OPEN" } });
    await expect(openShift(partner, { partnerId: "x", counts: [] })).rejects.toThrow(/still open/);
  });
});
