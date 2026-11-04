import { prisma, withTx } from "@/lib/db";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { D, money, Decimal } from "@/lib/money";
import type { PaymentMethod } from "@prisma/client";
import type { Actor } from "../actor";
import { dailyAllocations, submitPartnerPayment } from "./finance";

/**
 * What a closing-count partner owes for one day:
 *   owner share   = balance of that day's settlement invoice (PARTNERSHIP_SHARE)
 *   supplies used = cost of cups, cones & powder used that day, paid against their supply invoices
 */
export async function dailyDue(partnerId: string, reportId: string) {
  const report = await prisma.salesReport.findUnique({ where: { id: reportId }, include: { settlement: { include: { invoice: true } } } });
  if (!report || report.partnerId !== partnerId) throw new NotFoundError("Sales report");
  const shareInvoice = report.settlement?.status === "FINALIZED" ? report.settlement.invoice : null;
  const shareDue = shareInvoice && shareInvoice.status !== "CANCELLED" ? D(shareInvoice.amount).minus(D(shareInvoice.amountPaid)) : new Decimal(0);
  const payments = await prisma.payment.findMany({ where: { salesReportId: reportId, status: { in: ["CONFIRMED", "PENDING_VERIFICATION"] } }, include: { allocations: { include: { invoice: true } } } });
  const suppliesPaid = payments.filter((p) => p.status === "CONFIRMED").flatMap((p) => p.allocations).filter((a) => a.invoice?.type === "SUPPLY").reduce((a, x) => a.plus(D(x.amount)), new Decimal(0));
  const pending = payments.filter((p) => p.status === "PENDING_VERIFICATION").reduce((a, p) => a.plus(D(p.amount)), new Decimal(0));
  const supplyOutstanding = (await prisma.invoice.findMany({ where: { partnerId, type: "SUPPLY", status: { in: ["UNPAID", "PARTIALLY_PAID"] } } })).reduce((a, i) => a.plus(D(i.amount).minus(D(i.amountPaid))), new Decimal(0));
  const suppliesUsed = D(report.estimatedCogs);
  const suppliesDue = Decimal.max(0, Decimal.min(suppliesUsed.minus(suppliesPaid), supplyOutstanding));
  const total = money(shareDue.plus(suppliesDue));
  const remaining = Decimal.max(0, total.minus(pending));
  const ready = report.status === "APPROVED" && !!shareInvoice;
  return {
    report, ready, shareInvoice, shareDue: money(shareDue), suppliesUsed: money(suppliesUsed), suppliesPaid: money(suppliesPaid), suppliesDue: money(suppliesDue),
    total, pending: money(pending), remaining: money(remaining), payments,
    status: !ready ? ("WAITING" as const) : remaining.lte(0) && pending.lte(0) ? ("PAID" as const) : remaining.lte(0) ? ("PENDING" as const) : ("DUE" as const),
  };
}

export async function submitDailyPayment(actor: Actor, input: { reportId: string; paymentDate: Date; amount: string; method: PaymentMethod; reference?: string | null; notes?: string | null }) {
  if (actor.role !== "PARTNER" || !actor.partnerId) throw new ForbiddenError();
  const due = await dailyDue(actor.partnerId, input.reportId);
  if (!due.ready) throw new AppError("This day is not ready for payment yet — Scoop Master still has to approve the report.");
  if (D(input.amount).lte(0)) throw new AppError("Enter the amount you are paying.");
  const allocations = await withTx((tx) => dailyAllocations(tx, actor.partnerId!, input.reportId, input.amount));
  return submitPartnerPayment(actor, { ...input, salesReportId: input.reportId, notes: input.notes ?? `Daily pay-in for ${due.report.number}`, allocations });
}

/** Approved closing counts that still have something to pay (for the partner home screen). */
export async function unpaidDays(partnerId: string) {
  const reports = await prisma.salesReport.findMany({ where: { partnerId, method: "INVENTORY_COUNT", status: "APPROVED" }, orderBy: { reportDate: "desc" }, take: 14 });
  const out = [];
  for (const r of reports) {
    const d = await dailyDue(partnerId, r.id);
    if (d.status === "DUE" || d.status === "WAITING") out.push(d);
  }
  return out;
}
