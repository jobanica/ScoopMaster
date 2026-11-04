import type { PaymentStatus } from "@prisma/client";
import { D, type DecimalLike, Decimal } from "../money";

export type EffectiveStatus = PaymentStatus | "OVERDUE";

/** Stored status from amount/paid (OVERDUE is never stored; it is derived from the due date). */
export function statusFromPaid(amount: DecimalLike, paid: DecimalLike): PaymentStatus {
  const a = D(amount);
  const p = D(paid);
  if (p.lte(0)) return "UNPAID";
  if (p.gte(a)) return "PAID";
  return "PARTIALLY_PAID";
}

export function effectiveStatus(doc: { status: PaymentStatus; dueDate: Date; amount: DecimalLike; amountPaid: DecimalLike }, today: Date): EffectiveStatus {
  if (doc.status === "PAID" || doc.status === "CANCELLED") return doc.status;
  if (doc.dueDate < today && D(doc.amount).minus(D(doc.amountPaid)).gt(0)) return "OVERDUE";
  return doc.status;
}

export function balanceOf(doc: { amount: DecimalLike; amountPaid: DecimalLike; status?: PaymentStatus }): Decimal {
  if (doc.status === "CANCELLED") return new Decimal(0);
  return D(doc.amount).minus(D(doc.amountPaid));
}

/** Validates an allocation of a payment across documents. */
export function validateAllocations(paymentAmount: DecimalLike, allocations: { amount: DecimalLike; balance: DecimalLike; label: string }[]): string | null {
  let total = new Decimal(0);
  for (const a of allocations) {
    const amt = D(a.amount);
    if (amt.lte(0)) return `Allocation to ${a.label} must be greater than zero.`;
    if (amt.gt(D(a.balance))) return `Allocation to ${a.label} exceeds its outstanding balance.`;
    total = total.plus(amt);
  }
  if (total.gt(D(paymentAmount))) return "Allocations exceed the payment amount.";
  return null;
}
