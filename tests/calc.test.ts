import { describe, it, expect } from "vitest";
import { computeSettlement, type SettlementTerms } from "@/lib/calc/settlement";
import { computeSales } from "@/lib/calc/sales";
import { costRecipe, costProduct, consumptionPerUnit } from "@/lib/calc/recipe";
import { statusFromPaid, effectiveStatus, validateAllocations } from "@/lib/calc/payments";
import { weightedAverageCost, markup } from "@/lib/calc/inventory";
import { formatPHP, money, D } from "@/lib/money";
import { fmtDate, parseDateInput, dateFromYmd } from "@/lib/dates";
import { convertQty } from "@/lib/units";

const base: SettlementTerms = {
  shareModel: "PROFIT_SHARE", ownerSharePct: 50, fixedFee: 0, deductOperatingExpenses: true, shareLosses: true, cashCustody: "PARTNER",
};

describe("settlement", () => {
  it("matches the business example: 30,000 sales − 8,000 supplies − 2,000 expenses → 10,000 / 10,000", () => {
    const r = computeSettlement({ terms: base, grossSales: "30000", discounts: 0, refunds: 0, suppliesConsumed: "8000", expenses: [{ amount: "2000", paidBy: "PARTNER" }] });
    expect(r.distributableProfit.toFixed(2)).toBe("20000.00");
    expect(r.ownerShare.toFixed(2)).toBe("10000.00");
    expect(r.partnerShare.toFixed(2)).toBe("10000.00");
    expect(r.netDueToOwner.toFixed(2)).toBe("10000.00");
  });
  it("60/40 split, owner-paid expense reimbursed when partner holds cash", () => {
    const r = computeSettlement({ terms: { ...base, ownerSharePct: 60 }, grossSales: "30000", discounts: "500", refunds: "100", suppliesConsumed: "8000", expenses: [{ amount: "1000", paidBy: "OWNER" }, { amount: "1000", paidBy: "PARTNER" }] });
    expect(r.netSales.toFixed(2)).toBe("29400.00");
    expect(r.distributableProfit.toFixed(2)).toBe("19400.00");
    expect(r.ownerShare.toFixed(2)).toBe("11640.00");
    expect(r.partnerShare.toFixed(2)).toBe("7760.00");
    expect(r.netDueToOwner.toFixed(2)).toBe("12640.00");
  });
  it("never loses a centavo on odd splits", () => {
    const r = computeSettlement({ terms: { ...base, ownerSharePct: "33.33" }, grossSales: "1000.01", discounts: 0, refunds: 0, suppliesConsumed: 0, expenses: [] });
    expect(r.ownerShare.plus(r.partnerShare).toFixed(2)).toBe("1000.01");
  });
  it("fixed fee and fee-plus-share", () => {
    const f = computeSettlement({ terms: { ...base, shareModel: "FIXED_FEE", fixedFee: "5000" }, grossSales: "20000", discounts: 0, refunds: 0, suppliesConsumed: "6000", expenses: [] });
    expect(f.ownerShare.toFixed(2)).toBe("5000.00");
    expect(f.partnerShare.toFixed(2)).toBe("9000.00");
    const fp = computeSettlement({ terms: { ...base, shareModel: "FEE_PLUS_SHARE", fixedFee: "2000" }, grossSales: "20000", discounts: 0, refunds: 0, suppliesConsumed: "6000", expenses: [] });
    expect(fp.ownerShare.toFixed(2)).toBe("8000.00"); // 2000 + 50% of 12000
    expect(fp.partnerShare.toFixed(2)).toBe("6000.00");
  });
  it("revenue share and owner cash custody", () => {
    const r = computeSettlement({ terms: { ...base, shareModel: "REVENUE_SHARE", ownerSharePct: 20, cashCustody: "OWNER" }, grossSales: "10000", discounts: 0, refunds: 0, suppliesConsumed: "3000", expenses: [{ amount: "500", paidBy: "PARTNER" }] });
    expect(r.ownerShare.toFixed(2)).toBe("2000.00");
    expect(r.partnerShare.toFixed(2)).toBe("4500.00");
    expect(r.netDueToOwner.toFixed(2)).toBe("-5000.00"); // owner pays partner share + partner-paid expense
  });
  it("losses: shared vs not shared", () => {
    const shared = computeSettlement({ terms: base, grossSales: "1000", discounts: 0, refunds: 0, suppliesConsumed: "1500", expenses: [] });
    expect(shared.ownerShare.toFixed(2)).toBe("-250.00");
    const notShared = computeSettlement({ terms: { ...base, shareLosses: false }, grossSales: "1000", discounts: 0, refunds: 0, suppliesConsumed: "1500", expenses: [] });
    expect(notShared.ownerShare.toFixed(2)).toBe("0.00");
    expect(notShared.partnerShare.toFixed(2)).toBe("-500.00");
  });
  it("non-deductible expenses are neither deducted nor reimbursed", () => {
    const r = computeSettlement({ terms: { ...base, deductOperatingExpenses: false }, grossSales: "10000", discounts: 0, refunds: 0, suppliesConsumed: "2000", expenses: [{ amount: "1000", paidBy: "OWNER" }] });
    expect(r.distributableProfit.toFixed(2)).toBe("8000.00");
    expect(r.netDueToOwner.toFixed(2)).toBe("4000.00");
  });
});

describe("sales report", () => {
  const lines = [
    { productId: "cone", quantity: 50, unitPrice: "25", unitCost: "8.5" },
    { productId: "cup", quantity: 20, unitPrice: "35", wastageQty: 2, unitCost: "10" },
  ];
  it("computes totals and a clean report", () => {
    const r = computeSales({ lines, discounts: "50", refunds: 0, cashSales: "1350", gcashSales: "550", otherSales: 0, actualCash: "1350" });
    expect(r.grossSales.toFixed(2)).toBe("1950.00");
    expect(r.netSales.toFixed(2)).toBe("1900.00");
    expect(r.expectedCash.toFixed(2)).toBe("1350.00");
    expect(r.totalUnits).toBe(70);
    expect(r.estimatedCogs.toFixed(2)).toBe("645.00"); // 50*8.5 + 22*10
    expect(r.hasDiscrepancy).toBe(false);
  });
  it("flags cash shortage and reported total mismatch", () => {
    const r = computeSales({ lines, cashSales: "1400", gcashSales: "550", actualCash: "1300", reportedTotal: "2000" });
    expect(r.cashVariance.toFixed(2)).toBe("-100.00");
    expect(r.salesVariance.toFixed(2)).toBe("50.00");
    expect(r.hasDiscrepancy).toBe(true);
    expect(r.discrepancies.some((d) => d.includes("shortage"))).toBe(true);
  });
  it("respects tolerance", () => {
    const r = computeSales({ lines, cashSales: "1400", gcashSales: "550", actualCash: "1399.50", tolerance: "1" });
    expect(r.hasDiscrepancy).toBe(false);
  });
  it("rejects fractional quantities", () => {
    expect(() => computeSales({ lines: [{ productId: "x", quantity: 1.5, unitPrice: 10 }] })).toThrow();
  });
});

describe("recipe costing", () => {
  const powder = { id: "powder", uom: "KG" as const, avgCost: "350", partnerPrice: "420" };
  const cone = { id: "cone", uom: "PC" as const, avgCost: "1.50", partnerPrice: "2.00" };
  const recipe = {
    yieldGrams: "3700", wastagePct: "5",
    ingredients: [
      { itemId: "powder", name: "Powder", quantity: "1", uom: "KG" as const, item: powder },
      { itemId: null, name: "Water", quantity: "2.7", uom: "L" as const, unitCost: "0" },
    ],
  };
  it("1 kg powder + 2.7 L water → 3.7 kg mix cost breakdown", () => {
    const r = costRecipe(recipe);
    expect(r.batchCost.toFixed(2)).toBe("350.00");
    expect(r.costPerKg.toFixed(4)).toBe("94.5946");
    expect(r.effectiveCostPerGram.toFixed(6)).toBe(D(350).dividedBy(3700).dividedBy(0.95).toFixed(6));
  });
  it("80 g cone: servings, cost and profit", () => {
    const rc = costRecipe(recipe);
    const p = costProduct({ servingGrams: 80, price: 25, components: [{ itemId: "cone", quantity: 1, uom: "PC", item: cone }] }, rc);
    expect(p.theoreticalServings.toNumber()).toBe(46); // 3700/80
    expect(p.expectedServings.toNumber()).toBe(43); // 3515/80
    expect(money(p.unitCost).toFixed(2)).toBe("9.47"); // 80*0.0995733 + 1.50
    expect(money(p.grossProfit).toFixed(2)).toBe("15.53");
  });
  it("theoretical consumption per unit in item units", () => {
    const c = consumptionPerUnit(
      { servingGrams: 80, components: [{ itemId: "cone", quantity: 1, uom: "PC", item: cone }] },
      recipe,
    );
    expect(c.get("powder")!.toFixed(6)).toBe(D(80).dividedBy(3700).toFixed(6));
    expect(c.get("cone")!.toString()).toBe("1");
  });
});

describe("payments & inventory helpers", () => {
  it("status from paid amounts", () => {
    expect(statusFromPaid(100, 0)).toBe("UNPAID");
    expect(statusFromPaid(100, 40)).toBe("PARTIALLY_PAID");
    expect(statusFromPaid(100, 100)).toBe("PAID");
  });
  it("derives overdue", () => {
    const today = dateFromYmd("2026-11-04");
    expect(effectiveStatus({ status: "UNPAID", dueDate: dateFromYmd("2026-11-01"), amount: 100, amountPaid: 0 }, today)).toBe("OVERDUE");
    expect(effectiveStatus({ status: "PAID", dueDate: dateFromYmd("2026-11-01"), amount: 100, amountPaid: 100 }, today)).toBe("PAID");
    expect(effectiveStatus({ status: "UNPAID", dueDate: dateFromYmd("2026-11-04"), amount: 100, amountPaid: 0 }, today)).toBe("UNPAID");
  });
  it("validates allocations", () => {
    expect(validateAllocations(100, [{ amount: 60, balance: 50, label: "INV-1" }])).toMatch(/exceeds/);
    expect(validateAllocations(100, [{ amount: 60, balance: 80, label: "A" }, { amount: 50, balance: 80, label: "B" }])).toMatch(/exceed the payment/);
    expect(validateAllocations(100, [{ amount: 60, balance: 80, label: "A" }])).toBeNull();
  });
  it("weighted average cost", () => {
    expect(weightedAverageCost(10, 100, 10, 120).toFixed(2)).toBe("110.00");
    expect(weightedAverageCost(0, 100, 5, 90).toFixed(2)).toBe("90.00");
    expect(weightedAverageCost(-2, 100, 5, 90).toFixed(2)).toBe("90.00");
    expect(markup(100, 125).pct.toFixed(1)).toBe("25.0");
  });
});

describe("formatting", () => {
  it("formats PHP without floating point", () => {
    expect(formatPHP("1234567.885")).toBe("₱1,234,567.89");
    expect(formatPHP("-5")).toBe("-₱5.00");
    expect(formatPHP("0.1").length).toBeGreaterThan(0);
    expect(formatPHP(D("0.1").plus("0.2"))).toBe("₱0.30");
  });
  it("dates are DD/MM/YYYY", () => {
    expect(fmtDate(dateFromYmd("2026-11-04"))).toBe("04/11/2026");
    expect(parseDateInput("04/11/2026").toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(() => parseDateInput("31/02/2026")).toThrow();
  });
  it("converts units", () => {
    expect(convertQty("80", "G", "KG").toString()).toBe("0.08");
    expect(convertQty("2.7", "L", "ML").toString()).toBe("2700");
    expect(() => convertQty(1, "PC", "KG")).toThrow();
  });
});

import { computeCountReport } from "@/lib/calc/count";

describe("inventory-count reporting", () => {
  // Cone 80 g @ ₱25; 1 kg powder makes 3,700 g mix → 80/3700 kg powder per cone
  const perCone = new Map([["powder", D(80).dividedBy(3700)], ["cone", D(1)]]);
  const perCup = new Map([["powder", D(100).dividedBy(3700)], ["cup", D(1)], ["spoon", D(1)]]);
  const consumption = new Map([["CONE80", perCone], ["CUP100", perCup]]);
  const drivers = [{ containerItemId: "cone", productId: "CONE80", price: "25" }, { containerItemId: "cup", productId: "CUP100", price: "35" }];
  const base = [
    { itemId: "cone", name: "Cones", expected: "300", closing: "248", wasted: "2", unitValue: "2", isContainer: true },
    { itemId: "cup", name: "Cups", expected: "100", closing: "80", wasted: "0", unitValue: "2.5", isContainer: true },
    { itemId: "powder", name: "Powder", expected: "4", closing: "2.38", unitValue: "420", isContainer: false },
    { itemId: "spoon", name: "Spoons", expected: "100", closing: null, unitValue: "0.5", isContainer: false },
  ];

  it("derives units sold, sales, cost of goods and gross profit from closing counts", () => {
    const r = computeCountReport(base, drivers, consumption, { tolerancePct: 15 });
    // cones used 52, wasted 2 → 50 sold; cups 20 sold
    expect(r.lines.find((l) => l.productId === "CONE80")!.quantity).toBe(50);
    expect(r.lines.find((l) => l.productId === "CUP100")!.quantity).toBe(20);
    expect(r.grossSales.toFixed(2)).toBe("1950.00"); // 50×25 + 20×35
    // cost: cones 52×2=104, cups 20×2.5=50, powder 1.62×420=680.40, spoons (not counted → 20 estimated)×0.5=10
    expect(r.cogs.toFixed(2)).toBe("844.40");
    const gp = r.grossSales.minus(r.cogs);
    expect(gp.toFixed(2)).toBe("1105.60");
    // powder needed = (50×80 + 20×100)/3700 = 1.6216 kg; used 1.62 → within tolerance
    expect(r.checks[0].flagged).toBe(false);
  });
  it("flags powder used well beyond what the counted cones/cups explain", () => {
    const r = computeCountReport(base.map((i) => (i.itemId === "powder" ? { ...i, closing: "1.5" } : i)), drivers, consumption, { tolerancePct: 15 });
    expect(r.checks[0].flagged).toBe(true); // 2.5 kg used vs 1.62 kg needed ≈ +54%
    expect(r.checks[0].variancePct!.toFixed(0)).toBe("54");
  });
  it("rejects impossible counts", () => {
    expect(() => computeCountReport(base.map((i) => (i.itemId === "cone" ? { ...i, closing: "301" } : i)), drivers, consumption, { tolerancePct: 15 })).toThrow(/expected on hand|should be on hand/);
    expect(() => computeCountReport(base.map((i) => (i.itemId === "cone" ? { ...i, closing: null } : i)), drivers, consumption, { tolerancePct: 15 })).toThrow(/count Cones/);
    expect(() => computeCountReport(base.map((i) => (i.itemId === "cup" ? { ...i, closing: "80.5" } : i)), drivers, consumption, { tolerancePct: 15 })).toThrow(/whole pieces/);
  });
  it("splits the day's gross profit 50/50", () => {
    const r = computeCountReport(base, drivers, consumption, { tolerancePct: 15 });
    const s = computeSettlement({ terms: { ...{ shareModel: "PROFIT_SHARE", ownerSharePct: 50, fixedFee: 0, deductOperatingExpenses: false, shareLosses: true, cashCustody: "PARTNER" } as const }, grossSales: r.grossSales, discounts: 0, refunds: 0, suppliesConsumed: r.cogs, expenses: [] });
    expect(s.ownerShare.toFixed(2)).toBe("552.80");
    expect(s.partnerShare.toFixed(2)).toBe("552.80");
  });
});
