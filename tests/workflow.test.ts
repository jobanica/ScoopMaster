import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { D } from "@/lib/money";
import { addDays, dateFromYmd, todayDate } from "@/lib/dates";
import { resetDb, makeStaff } from "./helpers";
import type { Actor } from "@/server/actor";
import { saveItem, saveRecipe, saveProduct } from "@/server/services/catalog";
import { receiveStock, getWarehouse, getInTransit, createStockCount, saveCountLines, postStockCount, adjustStock } from "@/server/services/inventory";
import { createPartner, createContract, changePartnerStatus, setProductPrice, createUser } from "@/server/services/partners";
import { createMachine, assignMachine, machineProfitability } from "@/server/services/machines";
import { createSupplyRequest, reviewSupplyOrder, dispatchSupplyOrder, confirmSupplyReceipt } from "@/server/services/supply";
import { saveSalesReport, approveSalesReport, requestSalesEdit, reviewSalesEdit } from "@/server/services/sales";
import { submitPartnerExpense, reviewPartnerExpense, recordPayment, submitPartnerPayment, verifyPayment, voidPayment } from "@/server/services/finance";
import { createSettlement, submitSettlement, finalizeSettlement, voidSettlement } from "@/server/services/settlements";

let admin: Actor, finance: Actor, warehouse: Actor, partnerActor: Actor;
let powderId: string, coneId: string, cupId: string, coneProductId: string, cupProductId: string, partnerId: string, machineId: string;
const day1 = addDays(todayDate(), -3);
const day2 = addDays(todayDate(), -2);

async function level(itemId: string, locationId: string) {
  const l = await prisma.stockLevel.findUnique({ where: { itemId_locationId: { itemId, locationId } } });
  return D(l?.quantity).toString();
}

beforeAll(async () => {
  await resetDb();
  admin = await makeStaff("ADMIN", "admin@test.local");
  finance = await makeStaff("FINANCE", "fin@test.local");
  warehouse = await makeStaff("WAREHOUSE", "wh@test.local");
});
afterAll(async () => prisma.$disconnect());

describe("end-to-end partnership workflow", () => {
  it("sets up catalog: items, recipe (1 kg powder + 2.7 L water → 3.7 kg), products", async () => {
    powderId = (await saveItem(admin, { sku: "PWD-VAN", name: "Vanilla powder", category: "ICE_CREAM_POWDER", uom: "KG", purchaseCost: "300", partnerPrice: "400", minStock: "5", partnerMinStock: "1", isPerishable: true, isSellable: true, isActive: true })).id;
    coneId = (await saveItem(admin, { sku: "CONE-STD", name: "Cone", category: "CONES", uom: "PC", purchaseCost: "1.5", partnerPrice: "2", minStock: "100", partnerMinStock: "50", isPerishable: false, isSellable: true, isActive: true })).id;
    cupId = (await saveItem(admin, { sku: "CUP-8OZ", name: "Cup", category: "CUPS", uom: "PC", purchaseCost: "2", partnerPrice: "2.5", minStock: "100", partnerMinStock: "50", isPerishable: false, isSellable: true, isActive: true })).id;
    const recipe = await saveRecipe(admin, { code: "VAN", name: "Vanilla mix", yieldGrams: "3700", wastagePct: "5", isActive: true, ingredients: [{ itemId: powderId, name: "", quantity: "1", uom: "KG" }, { itemId: null, name: "Water", quantity: "2.7", uom: "L", unitCost: "0" }] });
    coneProductId = (await saveProduct(admin, { code: "CONE80", name: "Cone 80g", type: "CONE", recipeId: recipe.id, servingGrams: "80", defaultPrice: "25", isActive: true, components: [{ itemId: coneId, quantity: "1", uom: "PC" }] })).id;
    cupProductId = (await saveProduct(admin, { code: "CUP100", name: "Cup 100g", type: "CUP", recipeId: recipe.id, servingGrams: "100", defaultPrice: "35", isActive: true, components: [{ itemId: cupId, quantity: "1", uom: "PC" }] })).id;
    expect(coneProductId).toBeTruthy();
  });

  it("receives stock with weighted-average cost", async () => {
    await receiveStock(warehouse, { itemId: powderId, quantity: "10", unitCost: "300", batchNo: "B1", expiryDate: addDays(todayDate(), 20) });
    await receiveStock(warehouse, { itemId: powderId, quantity: "10", unitCost: "320", batchNo: "B2", expiryDate: addDays(todayDate(), 60) });
    await receiveStock(warehouse, { itemId: coneId, quantity: "1000", unitCost: "1.5" });
    await receiveStock(warehouse, { itemId: cupId, quantity: "500", unitCost: "2" });
    const p = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: powderId } });
    expect(D(p.avgCost).toFixed(2)).toBe("310.00");
    const wh = await getWarehouse();
    expect(await level(powderId, wh.id)).toBe("20");
  });

  it("refuses to issue more than on hand (no silent negative stock)", async () => {
    const wh = await getWarehouse();
    await expect(adjustStock(admin, { itemId: coneId, locationId: wh.id, quantity: "-5000", reason: "test" })).rejects.toThrow(/Insufficient/);
  });

  it("creates partner, contract, machine and deploys it", async () => {
    const p = await createPartner(admin, { businessName: "Kanto Sari-Sari", ownerName: "Juan Dela Cruz", area: "Quezon City" });
    partnerId = p.id;
    expect(p.code).toBe("PTR-0001");
    await expect(changePartnerStatus(admin, partnerId, "ACTIVE", "x")).rejects.toThrow(); // PROSPECT → ACTIVE not allowed directly
    await changePartnerStatus(admin, partnerId, "PENDING_APPROVAL", "docs complete");
    await expect(changePartnerStatus(admin, partnerId, "ACTIVE", "x")).rejects.toThrow(/contract/);
    await createContract(admin, partnerId, { effectiveFrom: addDays(todayDate(), -30), shareModel: "PROFIT_SHARE", ownerSharePct: "50", fixedFee: "0", cogsBasis: "TRANSFER_PRICE", deductOperatingExpenses: true, shareLosses: true, cashCustody: "PARTNER", settlementFrequency: "MONTHLY", paymentTermsDays: 7, supplyPaymentTermsDays: 15 });
    await changePartnerStatus(admin, partnerId, "ACTIVE", "approved");
    await setProductPrice(admin, partnerId, cupProductId, "40"); // partner-specific price
    const m = await createMachine(admin, { brand: "Generic", model: "SS-2", nozzles: 3, serialNumber: "SN-001", purchasePrice: "85000", condition: "NEW" });
    machineId = m.id;
    await assignMachine(admin, machineId, partnerId, addDays(todayDate(), -30), "Initial deployment");
    const u = await createUser(admin, { email: "partner@test.local", name: "Juan", password: "PartnerPass123", role: "PARTNER", partnerId });
    partnerActor = { id: u.id, role: "PARTNER", partnerId };
  });

  it("supply order: request → approve → dispatch → receive → invoice with markup", async () => {
    const order = await createSupplyRequest(partnerActor, { partnerId: "ignored-for-partners", lines: [{ itemId: powderId, quantity: "4" }, { itemId: coneId, quantity: "300" }, { itemId: cupId, quantity: "100" }] });
    expect(order.partnerId).toBe(partnerId);
    await reviewSupplyOrder(admin, order.id, { approve: true });
    await dispatchSupplyOrder(warehouse, order.id);
    const wh = await getWarehouse();
    const transit = await getInTransit();
    expect(await level(powderId, wh.id)).toBe("16");
    expect(await level(powderId, transit.id)).toBe("4");
    const lines = await prisma.supplyOrderLine.findMany({ where: { orderId: order.id } });
    const coneLine = lines.find((l) => l.itemId === coneId)!;
    const inv = await confirmSupplyReceipt(partnerActor, order.id, { receivedQty: { [coneLine.id]: "290" }, notes: "10 crushed" });
    const loc = await prisma.location.findUniqueOrThrow({ where: { partnerId } });
    expect(await level(coneId, loc.id)).toBe("290");
    expect(await level(coneId, transit.id)).toBe("0");
    // 4*400 + 290*2 + 100*2.5 = 1600 + 580 + 250
    expect(D(inv!.amount).toFixed(2)).toBe("2430.00");
    // cost: 4*310 + 290*1.5 + 100*2 = 1240 + 435 + 200
    expect(D(inv!.costAmount).toFixed(2)).toBe("1875.00");
    // FEFO: batch B1 (earliest expiry) consumed first
    const b1 = await prisma.stockBatch.findFirstOrThrow({ where: { batchNo: "B1" } });
    expect(D(b1.quantity).toString()).toBe("6");
  });

  it("sales report uses the partner's own prices, flags discrepancies, posts consumption on approval", async () => {
    // 40 cones @25 + 10 cups @40 (override) = 1000 + 400 = 1400
    const r = await saveSalesReport(partnerActor, {
      partnerId: "ignored", reportDate: day1, lines: [{ productId: coneProductId, quantity: 40, wastageQty: 1 }, { productId: cupProductId, quantity: 10, wastageQty: 0 }],
      discounts: "0", refunds: "0", cashSales: "1000", gcashSales: "400", otherSales: "0", actualCash: "950",
    }, { submit: true });
    expect(D(r.netSales).toFixed(2)).toBe("1400.00");
    expect(D(r.cashVariance).toFixed(2)).toBe("-50.00");
    expect(r.hasDiscrepancy).toBe(true);
    expect(r.machineId).toBe(machineId);
    const alerts = await prisma.notification.count({ where: { type: "CASH_DISCREPANCY" } });
    expect(alerts).toBeGreaterThan(0);
    // duplicate submission for same day blocked
    await expect(saveSalesReport(partnerActor, { partnerId, reportDate: day1, lines: [{ productId: coneProductId, quantity: 1, wastageQty: 0 }], discounts: "0", refunds: "0", cashSales: "25", gcashSales: "0", otherSales: "0" }, { submit: true })).rejects.toThrow(/already exists/);
    await approveSalesReport(admin, r.id);
    const loc = await prisma.location.findUniqueOrThrow({ where: { partnerId } });
    expect(await level(coneId, loc.id)).toBe("249"); // 290 - 40 sold - 1 wasted
    // powder consumption (40*80 + 10*100)/3700 = 1.1351 kg and wastage 1*80/3700 = 0.0216 kg — posted as separate movements
    expect(D(await level(powderId, loc.id)).toFixed(4)).toBe("2.8433");

    const r2 = await saveSalesReport(partnerActor, {
      partnerId, reportDate: day2, lines: [{ productId: coneProductId, quantity: 20, wastageQty: 0 }], discounts: "0", refunds: "0", cashSales: "500", gcashSales: "0", otherSales: "0",
    }, { submit: true });
    expect(r2.hasDiscrepancy).toBe(false);
    await approveSalesReport(admin, r2.id);
  });

  it("partner cannot edit a submitted report without approval; approved edit reverses ledger postings", async () => {
    const r2 = await prisma.salesReport.findFirstOrThrow({ where: { reportDate: day2 } });
    const req = await requestSalesEdit(partnerActor, r2.id, "Typo in cones");
    const loc = await prisma.location.findUniqueOrThrow({ where: { partnerId } });
    const before = await level(coneId, loc.id);
    await reviewSalesEdit(admin, req.id, true, "ok");
    expect(await level(coneId, loc.id)).toBe(D(before).plus(20).toString());
    const reopened = await saveSalesReport(partnerActor, { partnerId, reportDate: day2, lines: [{ productId: coneProductId, quantity: 22, wastageQty: 0 }], discounts: "0", refunds: "0", cashSales: "550", gcashSales: "0", otherSales: "0" }, { submit: true });
    expect(reopened.revision).toBe(1);
    await approveSalesReport(admin, reopened.id);
    expect(await level(coneId, loc.id)).toBe(D(before).minus(2).toString());
  });

  it("settlement: sales − supplies consumed − approved expenses, split 50/50, no double counting", async () => {
    const e = await submitPartnerExpense(partnerActor, { partnerId, expenseDate: day1, category: "Electricity", description: "Share of electric bill", amount: "100", paidBy: "PARTNER" });
    await reviewPartnerExpense(finance, e.id, true);
    const start = addDays(todayDate(), -30);
    const end = addDays(todayDate(), -1);
    const s = await createSettlement(finance, { partnerId, periodStart: start, periodEnd: end });
    // Net sales: 1400 + 550 = 1950
    expect(D(s.netSales).toFixed(2)).toBe("1950.00");
    // supplies consumed valued at transfer price from the ledger = sum of CONSUMPTION/WASTAGE movements (net of reversals)
    const loc = await prisma.location.findUniqueOrThrow({ where: { partnerId } });
    const mv = await prisma.stockMovement.findMany({ where: { locationId: loc.id, type: { in: ["CONSUMPTION", "WASTAGE", "REVERSAL"] } } });
    const expected = mv.reduce((a, m) => a.plus(D(m.quantity).negated().times(D(m.unitPrice))), D(0));
    expect(D(s.suppliesConsumed).toFixed(2)).toBe(expected.toDecimalPlaces(2).toFixed(2));
    const dist = D(1950).minus(D(s.suppliesConsumed)).minus(100);
    expect(D(s.distributableProfit).toFixed(2)).toBe(dist.toFixed(2));
    expect(D(s.ownerShare).plus(D(s.partnerShare)).toFixed(2)).toBe(dist.toFixed(2));
    // markup is reported separately, not added to the split
    expect(D(s.supplyMarkupInPeriod).toFixed(2)).toBe("0.00"); // invoice issued today, outside the period
    expect(D(s.supplyInvoicesOutstanding).toFixed(2)).toBe("2430.00");

    await submitSettlement(finance, s.id);
    // period is now locked
    await expect(saveSalesReport(partnerActor, { partnerId, reportDate: addDays(todayDate(), -5), lines: [{ productId: coneProductId, quantity: 1, wastageQty: 0 }], discounts: "0", refunds: "0", cashSales: "25", gcashSales: "0", otherSales: "0" }, { submit: true })).rejects.toThrow(/falls within settlement/);
    // preparer cannot approve; finance lacks approve permission anyway
    await expect(finalizeSettlement(finance, s.id)).rejects.toThrow();
    await finalizeSettlement(admin, s.id);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { settlementId: s.id } });
    expect(inv.type).toBe("PARTNERSHIP_SHARE");
    expect(D(inv.amount).toFixed(2)).toBe(D(s.ownerShare).toFixed(2));
    // overlapping settlement rejected
    await expect(createSettlement(finance, { partnerId, periodStart: addDays(todayDate(), -10), periodEnd: addDays(todayDate(), -1) })).rejects.toThrow(/overlaps/);
  });

  it("payments: partner submits proof → finance verifies → balances move; partial payments; void restores", async () => {
    const supplyInv = await prisma.invoice.findFirstOrThrow({ where: { type: "SUPPLY", partnerId } });
    const pending = await submitPartnerPayment(partnerActor, { paymentDate: todayDate(), amount: "1000", method: "GCASH", reference: "GC123", allocations: [{ invoiceId: supplyInv.id, amount: "1000" }] });
    let inv = await prisma.invoice.findUniqueOrThrow({ where: { id: supplyInv.id } });
    expect(D(inv.amountPaid).toFixed(2)).toBe("0.00"); // not applied until verified
    await verifyPayment(finance, pending.id, true);
    inv = await prisma.invoice.findUniqueOrThrow({ where: { id: supplyInv.id } });
    expect(inv.status).toBe("PARTIALLY_PAID");
    expect(D(inv.amountPaid).toFixed(2)).toBe("1000.00");
    await expect(recordPayment(finance, { direction: "IN", paymentDate: todayDate(), amount: "5000", method: "CASH", partyName: "x", partnerId, allocations: [{ invoiceId: supplyInv.id, amount: "5000" }] })).rejects.toThrow(/exceeds/);
    const p2 = await recordPayment(finance, { direction: "IN", paymentDate: todayDate(), amount: "1430", method: "CASH", partyName: "Kanto", partnerId, allocations: [{ invoiceId: supplyInv.id, amount: "1430" }] });
    inv = await prisma.invoice.findUniqueOrThrow({ where: { id: supplyInv.id } });
    expect(inv.status).toBe("PAID");
    await voidPayment(finance, p2.id, "bounced");
    inv = await prisma.invoice.findUniqueOrThrow({ where: { id: supplyInv.id } });
    expect(inv.status).toBe("PARTIALLY_PAID");
  });

  it("void settlement is blocked while its invoice has payments, and releases reports when voided", async () => {
    const s = await prisma.settlement.findFirstOrThrow({ where: { partnerId, status: "FINALIZED" }, include: { invoice: true } });
    const pay = await recordPayment(finance, { direction: "IN", paymentDate: todayDate(), amount: "10", method: "CASH", partyName: "Kanto", partnerId, allocations: [{ invoiceId: s.invoice!.id, amount: "10" }] });
    await expect(voidSettlement(admin, s.id, "wrong period")).rejects.toThrow(/Void those payments/);
    await voidPayment(finance, pay.id, "reversal");
    await voidSettlement(admin, s.id, "wrong period");
    expect(await prisma.salesReport.count({ where: { settlementId: s.id } })).toBe(0);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: s.invoice!.id } });
    expect(inv.status).toBe("CANCELLED");
  });

  it("physical count posts variance movements; audit log records every change", async () => {
    const loc = await prisma.location.findUniqueOrThrow({ where: { partnerId } });
    const c = await createStockCount(admin, { locationId: loc.id, countDate: todayDate() });
    const lines = await prisma.stockCountLine.findMany({ where: { countId: c.id } });
    const coneLine = lines.find((l) => l.itemId === coneId)!;
    await saveCountLines(admin, c.id, [{ lineId: coneLine.id, countedQty: "200", reason: "physical" }]);
    const posted = await postStockCount(admin, c.id);
    expect(posted).toBe(1);
    expect(await level(coneId, loc.id)).toBe("200");
    expect(await prisma.auditLog.count()).toBeGreaterThan(30);
  });

  it("machine profitability attributes owner income from finalized settlements", async () => {
    const rows = await machineProfitability(machineId);
    expect(rows[0].totalSales.toFixed(2)).toBe("1950.00");
    expect(rows[0].utilizationPct).toBeGreaterThan(0);
  });

  it("business dates use Asia/Manila", () => {
    expect(dateFromYmd("2026-01-31").toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
});
