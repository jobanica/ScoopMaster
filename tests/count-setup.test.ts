import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { D } from "@/lib/money";
import { addDays, todayDate } from "@/lib/dates";
import { resetDb, makeStaff } from "./helpers";
import type { Actor } from "@/server/actor";
import { saveItem, saveProduct } from "@/server/services/catalog";
import { receiveStock } from "@/server/services/inventory";
import { createPartner, createContract, changePartnerStatus, createUser } from "@/server/services/partners";
import { createSupplyRequest, reviewSupplyOrder, dispatchSupplyOrder, confirmSupplyReceipt } from "@/server/services/supply";
import { saveCountReport, rejectSalesReport, countDrivers, setCountProduct } from "@/server/services/sales";
import { openShift } from "@/server/services/shifts";
import { repairRejectedCountPostings } from "../prisma/repair";

// Mirrors a real production setup: products with serving sizes but NOT linked to cone/cup items, and no recipes.
let admin: Actor, partner: Actor;
const ids: Record<string, string> = {};
const today = todayDate();
const level = async (k: string) => D((await prisma.stockLevel.findFirst({ where: { itemId: ids[k], location: { partnerId: partner.partnerId! } } }))?.quantity).toString();
const counts = (c: Record<string, string | null>, w: Record<string, string> = {}) => Object.entries(c).map(([k, v]) => ({ itemId: ids[k], closing: v, wasted: w[k] ?? null }));
const pay = { discounts: "0", refunds: "0", otherSales: "0", gcashSales: "0" };

beforeAll(async () => {
  await resetDb();
  admin = await makeStaff("ADMIN", "a@s.local");
  const wh = await makeStaff("WAREHOUSE", "w@s.local");
  const item = (sku: string, name: string, category: "ICE_CREAM_POWDER" | "CONES" | "CUPS", uom: "KG" | "PC", price: string) =>
    saveItem(admin, { sku, name, category, uom, purchaseCost: "1", partnerPrice: price, minStock: "0", partnerMinStock: "0", isPerishable: false, isSellable: true, isActive: true });
  ids.powder = (await item("ICPV", "Ice Cream Powder Vanilla", "ICE_CREAM_POWDER", "KG", "280")).id;
  ids.small = (await item("ICCS", "Ice Cream Cones Small", "CONES", "PC", "2")).id;
  ids.sugar = (await item("ICCM", "Sugar Cones", "CONES", "PC", "6.5")).id;
  ids.cup6 = (await item("CUPS6", "6oz Cups", "CUPS", "PC", "4")).id;
  for (const k of ["powder", "small", "sugar", "cup6"]) await receiveStock(wh, { itemId: ids[k], quantity: "500", unitCost: "1" });
  ids.smallP = (await saveProduct(admin, { code: "CONE01", name: "Small Cone", type: "CONE", servingGrams: "50", defaultPrice: "15", isActive: true, components: [] })).id;
  ids.sugarP = (await saveProduct(admin, { code: "CONE02", name: "Sugar Cone", type: "CONE", servingGrams: "80", defaultPrice: "25", isActive: true, components: [] })).id;
  ids.cupP = (await saveProduct(admin, { code: "CUP01", name: "6oz Cup", type: "CUP", servingGrams: "150", defaultPrice: "40", isActive: true, components: [] })).id;
  const p = await createPartner(admin, { businessName: "Real Setup Store", ownerName: "B" });
  await changePartnerStatus(admin, p.id, "PENDING_APPROVAL", "x");
  await createContract(admin, p.id, { effectiveFrom: today, shareModel: "PROFIT_SHARE", ownerSharePct: "50", fixedFee: "0", cogsBasis: "TRANSFER_PRICE", deductOperatingExpenses: false, shareLosses: true, cashCustody: "PARTNER", settlementFrequency: "DAILY", reportingMethod: "INVENTORY_COUNT", paymentTermsDays: 1, supplyPaymentTermsDays: 15 });
  await changePartnerStatus(admin, p.id, "ACTIVE", "x");
  const u = await createUser(admin, { email: "p@s.local", name: "P", password: "PartnerPass123", role: "PARTNER", partnerId: p.id });
  partner = { id: u.id, role: "PARTNER", partnerId: p.id };
  const so = await createSupplyRequest(partner, { partnerId: p.id, lines: [{ itemId: ids.powder, quantity: "5" }, { itemId: ids.small, quantity: "200" }, { itemId: ids.sugar, quantity: "100" }, { itemId: ids.cup6, quantity: "50" }] });
  await reviewSupplyOrder(admin, so.id, { approve: true });
  await dispatchSupplyOrder(wh, so.id);
  await confirmSupplyReceipt(partner, so.id, { receivedQty: {} });
});
afterAll(async () => prisma.$disconnect());

describe("closing count with products not linked to cones/cups", () => {
  it("never silently reports zero sales: unmatched cones/cups block the count with a clear message", async () => {
    await openShift(partner, { partnerId: "x", counts: [] });
    await expect(saveCountReport(partner, { partnerId: "x", reportDate: today, counts: counts({ small: "100", sugar: "75", cup6: "40", powder: "2" }), ...pay, cashSales: "0" }, { submit: true })).rejects.toThrow(/needs to set which product .*Ice Cream Cones Small/);
  });

  it("suggests matches by name and accepts same-type products", async () => {
    const d = await countDrivers(prisma, partner.partnerId!);
    expect(d.find((x) => x.item.id === ids.small)!.suggestion?.id).toBe(ids.smallP);
    expect(d.find((x) => x.item.id === ids.sugar)!.suggestion?.id).toBe(ids.sugarP);
    expect(d.find((x) => x.item.id === ids.cup6)!.suggestion?.id).toBe(ids.cupP);
    for (const [item, prod] of [["small", "smallP"], ["sugar", "sugarP"], ["cup6", "cupP"]]) await setCountProduct(admin, partner.partnerId!, ids[item], ids[prod]);
  });

  it("derives sold units automatically from what is left, with no recipes set up", async () => {
    // delivered 200 small / 100 sugar / 50 cups / 5 kg; left 100 / 75 / 40 / 2 kg; 2 small broken
    const r = await saveCountReport(partner, { partnerId: "x", reportDate: today, counts: counts({ small: "100", sugar: "75", cup6: "40", powder: "2" }, { small: "2" }), ...pay, cashSales: "4335" }, { submit: true });
    expect(r.totalUnits).toBe(98 + 25 + 10);
    expect(D(r.netSales).toFixed(2)).toBe("2495.00"); // 98×15 + 25×25 + 10×40 = 1470 + 625 + 400
    // cost: small 100×2 + sugar 25×6.5 + cups 10×4 + powder 3×280 = 200 + 162.5 + 40 + 840
    expect(D(r.estimatedCogs).toFixed(2)).toBe("1242.50");
    expect(r.discrepancyNotes ?? "").not.toMatch(/Powder/); // no recipes → no false powder alarm
    expect(await level("small")).toBe("100");
    expect(await level("powder")).toBe("2");
  });

  it("rejecting a count puts the stock back and reopens the shift", async () => {
    const r = await prisma.salesReport.findFirstOrThrow({ where: { partnerId: partner.partnerId! } });
    await rejectSalesReport(admin, r.id, "recount please");
    expect(await level("small")).toBe("200");
    expect(await level("powder")).toBe("5");
    expect((await prisma.shift.findFirstOrThrow({ where: { partnerId: partner.partnerId! } })).status).toBe("OPEN");
  });

  it("repairs counts that were rejected before the fix (stock postings left behind)", async () => {
    const r = await saveCountReport(partner, { partnerId: "x", reportDate: today, counts: counts({ small: "150", sugar: "90", cup6: "45", powder: "4" }), ...pay, cashSales: "1500" }, { submit: true });
    expect(await level("small")).toBe("150");
    await prisma.salesReport.update({ where: { id: r.id }, data: { status: "REJECTED" } }); // simulate the old behaviour
    expect(await repairRejectedCountPostings()).toBe(1);
    expect(await level("small")).toBe("200");
    expect(await level("powder")).toBe("5");
    expect(await repairRejectedCountPostings()).toBe(0); // idempotent
    expect(await prisma.auditLog.count({ where: { action: "DATA_REPAIR" } })).toBe(1);
  });
});
