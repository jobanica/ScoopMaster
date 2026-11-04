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
