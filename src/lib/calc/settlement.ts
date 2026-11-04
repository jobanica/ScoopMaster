import type { CashCustody, ShareModel } from "@prisma/client";
import { D, money, type DecimalLike, Decimal } from "../money";

export type SettlementTerms = {
  shareModel: ShareModel;
  ownerSharePct: DecimalLike;
  fixedFee: DecimalLike;
  deductOperatingExpenses: boolean;
  shareLosses: boolean;
  cashCustody: CashCustody;
};

export type SettlementInput = {
  terms: SettlementTerms;
  grossSales: DecimalLike;
  discounts: DecimalLike;
  refunds: DecimalLike;
  suppliesConsumed: DecimalLike; // valued per contract COGS basis
  expenses: { amount: DecimalLike; paidBy: "PARTNER" | "OWNER" }[]; // approved partner-location expenses
};

export type SettlementResult = {
  netSales: Decimal;
  suppliesConsumed: Decimal;
  operatingExpenses: Decimal;
  distributableProfit: Decimal;
  fixedFee: Decimal;
  ownerShare: Decimal;
  partnerShare: Decimal;
  ownerPaidExpenses: Decimal;
  partnerPaidExpenses: Decimal;
  /** + : partner must remit to owner; - : owner must pay partner. */
  netDueToOwner: Decimal;
  steps: string[];
};

/**
 * Partnership profit-sharing per contract.
 *
 *   net sales            = gross − discounts − refunds
 *   distributable profit = net sales − supplies consumed − approved operating expenses (if deductible)
 *   shares               = per share model; owner share rounded to centavos, partner = remainder (no lost centavos)
 *
 * Supply-markup income is NOT part of this computation (it is earned on the supply invoice), and
 * unpaid supply invoices are NOT deducted here (they are a separate receivable). This prevents double counting.
 *
 * Cash settlement:
 *   custody PARTNER: partner holds the sales cash → owes owner (ownerShare + expenses the owner paid on the partnership's behalf)
 *   custody OWNER:   owner holds the sales cash  → owes partner (partnerShare + expenses the partner paid)
 */
export function computeSettlement(input: SettlementInput): SettlementResult {
  const t = input.terms;
  const steps: string[] = [];
  const pct = D(t.ownerSharePct);
  if (pct.isNegative() || pct.gt(100)) throw new Error("Owner share must be between 0% and 100%.");
  const netSales = money(input.grossSales).minus(money(input.discounts)).minus(money(input.refunds));
  const supplies = money(input.suppliesConsumed);
  const ownerPaid = money(input.expenses.filter((e) => e.paidBy === "OWNER").reduce((a, e) => a.plus(D(e.amount)), new Decimal(0)));
  const partnerPaid = money(input.expenses.filter((e) => e.paidBy === "PARTNER").reduce((a, e) => a.plus(D(e.amount)), new Decimal(0)));
  const opex = t.deductOperatingExpenses ? ownerPaid.plus(partnerPaid) : new Decimal(0);
  const distributable = netSales.minus(supplies).minus(opex);
  steps.push(`Net sales ${netSales.toFixed(2)} − supplies ${supplies.toFixed(2)} − expenses ${opex.toFixed(2)} = ${distributable.toFixed(2)}`);

  const fee = money(t.fixedFee);
  let ownerShare: Decimal;
  let base: Decimal;
  switch (t.shareModel) {
    case "PROFIT_SHARE":
      base = distributable.isNegative() && !t.shareLosses ? new Decimal(0) : distributable;
      ownerShare = money(base.times(pct).dividedBy(100));
      steps.push(`Owner ${pct}% of ${base.toFixed(2)} = ${ownerShare.toFixed(2)}`);
      break;
    case "FIXED_FEE":
      ownerShare = fee;
      steps.push(`Owner fixed fee ${fee.toFixed(2)}`);
      break;
    case "FEE_PLUS_SHARE": {
      const remainder = distributable.minus(fee);
      base = remainder.isNegative() && !t.shareLosses ? new Decimal(0) : remainder;
      ownerShare = fee.plus(money(base.times(pct).dividedBy(100)));
      steps.push(`Owner fee ${fee.toFixed(2)} + ${pct}% of ${base.toFixed(2)} = ${ownerShare.toFixed(2)}`);
      break;
    }
    case "REVENUE_SHARE":
      ownerShare = money(netSales.times(pct).dividedBy(100));
      steps.push(`Owner ${pct}% of net sales ${netSales.toFixed(2)} = ${ownerShare.toFixed(2)}`);
      break;
  }
  // When losses are not shared, the owner never absorbs a loss beyond the fee arrangement.
  const partnerShare = distributable.minus(ownerShare);
  steps.push(`Partner share = ${distributable.toFixed(2)} − ${ownerShare.toFixed(2)} = ${partnerShare.toFixed(2)}`);

  // Expenses that were not deducted are not reimbursed through the settlement either.
  const reimburseOwner = t.deductOperatingExpenses ? ownerPaid : new Decimal(0);
  const reimbursePartner = t.deductOperatingExpenses ? partnerPaid : new Decimal(0);
  const netDueToOwner =
    t.cashCustody === "PARTNER" ? ownerShare.plus(reimburseOwner) : partnerShare.plus(reimbursePartner).negated();
  steps.push(
    t.cashCustody === "PARTNER"
      ? `Partner holds cash: remits owner share ${ownerShare.toFixed(2)} + owner-paid expenses ${reimburseOwner.toFixed(2)} = ${netDueToOwner.toFixed(2)}`
      : `Owner holds cash: pays partner share ${partnerShare.toFixed(2)} + partner-paid expenses ${reimbursePartner.toFixed(2)} = ${netDueToOwner.negated().toFixed(2)}`,
  );

  return {
    netSales, suppliesConsumed: supplies, operatingExpenses: opex, distributableProfit: distributable, fixedFee: t.shareModel === "FIXED_FEE" || t.shareModel === "FEE_PLUS_SHARE" ? fee : new Decimal(0),
    ownerShare, partnerShare, ownerPaidExpenses: ownerPaid, partnerPaidExpenses: partnerPaid, netDueToOwner, steps,
  };
}
