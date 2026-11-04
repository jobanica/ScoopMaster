import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { D } from "@/lib/money";
import { todayDate } from "@/lib/dates";
import { resetDb, makeStaff } from "./helpers";
import type { Actor } from "@/server/actor";
import { saveItem, saveProduct } from "@/server/services/catalog";
import { receiveStock } from "@/server/services/inventory";
import { createPartner, createContract, changePartnerStatus, createUser } from "@/server/services/partners";
import { createSupplyRequest, reviewSupplyOrder, dispatchSupplyOrder, confirmSupplyReceipt } from "@/server/services/supply";
import { saveCountReport, approveSalesReport, setCountProduct } from "@/server/services/sales";
import { verifyPayment } from "@/server/services/finance";
import { dailyDue, submitDailyPayment } from "@/server/services/daily-pay";

let admin: Actor, finance: Actor, partner: Actor, reportId: string;
const ids: Record<string, string> = {};
const today = todayDate();

beforeAll(async () => {
  await resetDb();
  admin = await makeStaff("ADMIN", "a@d.local");
  finance = await makeStaff("FINANCE", "f@d.local");
  const wh = await makeStaff("WAREHOUSE", "w@d.local");
  const item = (sku: string, name: string, category: "ICE_CREAM_POWDER" | "CONES", uom: "KG" | "PC", price: string) =>
    saveItem(admin, { sku, name, category, uom, purchaseCost: "1", partnerPrice: price, minStock: "0", partnerMinStock: "0", isPerishable: false, isSellable: true, isActive: true });
  ids.powder = (await item("P", "Powder", "ICE_CREAM_POWDER", "KG", "280")).id;
  ids.cone = (await item("C", "Sugar Cones", "CONES", "PC", "6.5")).id;
  for (const k of ["powder", "cone"]) await receiveStock(wh, { itemId: ids[k], quantity: "500", unitCost: "1" });
  ids.coneP = (await saveProduct(admin, { code: "SC", name: "Sugar Cone", type: "CONE", servingGrams: "80", defaultPrice: "25", isActive: true, components: [] })).id;
  const p = await createPartner(admin, { businessName: "Pay Store", ownerName: "B" });
  await changePartnerStatus(admin, p.id, "PENDING_APPROVAL", "x");
  await createContract(admin, p.id, { effectiveFrom: today, shareModel: "PROFIT_SHARE", ownerSharePct: "50", fixedFee: "0", cogsBasis: "TRANSFER_PRICE", deductOperatingExpenses: false, shareLosses: true, cashCustody: "PARTNER", settlementFrequency: "DAILY", reportingMethod: "INVENTORY_COUNT", paymentTermsDays: 0, supplyPaymentTermsDays: 15 });
  await changePartnerStatus(admin, p.id, "ACTIVE", "x");
  await setCountProduct(admin, p.id, ids.cone, ids.coneP);
  const u = await createUser(admin, { email: "p@d.local", name: "P", password: "PartnerPass123", role: "PARTNER", partnerId: p.id });
  partner = { id: u.id, role: "PARTNER", partnerId: p.id };
  // supplies: 5 kg × 280 + 200 cones × 6.5 = 1,400 + 1,300 = ₱2,700 supply invoice
  const so = await createSupplyRequest(partner, { partnerId: p.id, lines: [{ itemId: ids.powder, quantity: "5" }, { itemId: ids.cone, quantity: "200" }] });
  await reviewSupplyOrder(admin, so.id, { approve: true });
  await dispatchSupplyOrder(wh, so.id);
  await confirmSupplyReceipt(partner, so.id, { receivedQty: {} });
  // closing: 120 cones left (80 sold × 25 = 2,000), 4 kg powder left (1 kg used)
  const r = await saveCountReport(partner, { partnerId: "x", reportDate: today, counts: [{ itemId: ids.cone, closing: "120", wasted: null }, { itemId: ids.powder, closing: "4", wasted: null }], discounts: "0", refunds: "0", cashSales: "2000", gcashSales: "0", otherSales: "0" }, { submit: true });
  reportId = r.id;
});
afterAll(async () => prisma.$disconnect());

describe("daily pay-in: owner share first, then supplies used", () => {
  it("is not payable until approved", async () => {
    expect((await dailyDue(partner.partnerId!, reportId)).status).toBe("WAITING");
    await expect(submitDailyPayment(partner, { reportId, paymentDate: today, amount: "100", method: "GCASH" })).rejects.toThrow(/not ready/);
  });

  it("approval settles the day; partner owes owner share + supplies used", async () => {
    await approveSalesReport(admin, reportId);
    const due = await dailyDue(partner.partnerId!, reportId);
    // cost used: 80 cones × 6.5 = 520 + 1 kg × 280 = 280 → 800; gross profit 2,000 − 800 = 1,200 → owner 600
    expect(due.status).toBe("DUE");
    expect(due.shareDue.toFixed(2)).toBe("600.00");
    expect(due.suppliesDue.toFixed(2)).toBe("800.00");
    expect(due.total.toFixed(2)).toBe("1400.00");
  });

  it("a partial payment covers the owner share first", async () => {
    const p = await submitDailyPayment(partner, { reportId, paymentDate: today, amount: "1000", method: "GCASH", reference: "GC1" });
    expect((await dailyDue(partner.partnerId!, reportId)).status).toBe("DUE");
    expect((await dailyDue(partner.partnerId!, reportId)).remaining.toFixed(2)).toBe("400.00");
    await verifyPayment(finance, p.id, true);
    const share = await prisma.invoice.findFirstOrThrow({ where: { type: "PARTNERSHIP_SHARE" } });
    const supply = await prisma.invoice.findFirstOrThrow({ where: { type: "SUPPLY" } });
    expect(share.status).toBe("PAID"); // 600 to the share
    expect(D(supply.amountPaid).toFixed(2)).toBe("400.00"); // the other 400 reduces the supply receivable
    const due = await dailyDue(partner.partnerId!, reportId);
    expect(due.shareDue.toFixed(2)).toBe("0.00");
    expect(due.suppliesDue.toFixed(2)).toBe("400.00");
  });

  it("paying the rest clears the day and lowers the supply receivable by the supplies used", async () => {
    const p = await submitDailyPayment(partner, { reportId, paymentDate: today, amount: "400", method: "CASH" });
    expect((await dailyDue(partner.partnerId!, reportId)).status).toBe("PENDING");
    await verifyPayment(finance, p.id, true);
    expect((await dailyDue(partner.partnerId!, reportId)).status).toBe("PAID");
    const supply = await prisma.invoice.findFirstOrThrow({ where: { type: "SUPPLY" } });
    expect(D(supply.amount).minus(D(supply.amountPaid)).toFixed(2)).toBe("1900.00"); // 2,700 − 800 used
  });
});

import { settleReportDay } from "@/server/services/settlements";
describe("settle this day now", () => {
  it("is safe to press again on a settled day", async () => {
    const s = await prisma.settlement.findFirstOrThrow();
    expect(s.status).toBe("FINALIZED");
    expect(await settleReportDay(admin, reportId)).toBe("already settled");
  });
});
