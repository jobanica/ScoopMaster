"use server";
import { requirePartnerAction } from "@/lib/auth";
import { safeAction } from "@/lib/action";
import { amount, date, oneOf, optStr, str } from "@/lib/form";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { storeUpload } from "@/lib/storage";
import { saveSalesReport, requestSalesEdit } from "@/server/services/sales";
import { cancelSupplyOrder, confirmSupplyReceipt, createSupplyRequest } from "@/server/services/supply";
import { submitPartnerExpense, submitPartnerPayment } from "@/server/services/finance";
import { reportMachineProblem } from "@/server/services/machines";
import { intentSubmit, parseSalesForm } from "@/server/sales-form-data";
import { parseSupplyLines, qtyMap } from "@/server/supply-form";

// Every action derives the partner from the session — a partnerId from the browser is never trusted.

export const partnerSaveSalesAction = safeAction(async (fd) => {
  const user = await requirePartnerAction();
  const r = await saveSalesReport(user, parseSalesForm(fd, user.partnerId), { submit: intentSubmit(fd) });
  return `/portal/sales/${r.id}`;
});
export const partnerEditRequestAction = safeAction(async (fd) => {
  const user = await requirePartnerAction();
  const id = str(fd, "id");
  await requestSalesEdit(user, id, str(fd, "reason", "Reason"));
  return { revalidate: [`/portal/sales/${id}`], message: "Edit request sent to Scoop Master." };
});
export const partnerSupplyRequestAction = safeAction(async (fd) => {
  const user = await requirePartnerAction();
  const o = await createSupplyRequest(user, { partnerId: user.partnerId, notes: optStr(fd, "notes"), lines: parseSupplyLines(fd) });
  return `/portal/supply-requests/${o.id}`;
});
export const partnerReceiveAction = safeAction(async (fd) => {
  const user = await requirePartnerAction();
  const id = str(fd, "id");
  await confirmSupplyReceipt(user, id, { receivedQty: qtyMap(fd, "received_"), notes: optStr(fd, "notes") });
  return { revalidate: [`/portal/supply-requests/${id}`], message: "Thank you! Receipt confirmed and your stock updated." };
});
export const partnerCancelSupplyAction = safeAction(async (fd) => {
  const user = await requirePartnerAction();
  const id = str(fd, "id");
  await cancelSupplyOrder(user, id, str(fd, "reason", "Reason"));
  return { revalidate: [`/portal/supply-requests/${id}`], message: "Request cancelled." };
});
export const partnerPaymentAction = safeAction(async (fd) => {
  const user = await requirePartnerAction();
  const allocs: { invoiceId: string; amount: string }[] = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("alloc_") || typeof v !== "string" || !v.trim()) continue;
    const a = v.replace(/[,₱\s]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(a)) throw new AppError("Amounts must be valid peso amounts.");
    if (Number(a) > 0) allocs.push({ invoiceId: k.slice(6), amount: a });
  }
  const file = fd.get("proof");
  const stored = file instanceof File && file.size > 0 ? await storeUpload(file) : null;
  if (!stored) throw new AppError("Please attach your proof of payment (photo or PDF).");
  const p = await submitPartnerPayment(user, { paymentDate: date(fd, "paymentDate", "Payment date"), amount: amount(fd, "amount", "Amount"), method: oneOf(fd, "method", ["CASH", "GCASH", "BANK_TRANSFER", "OTHER"] as const), reference: optStr(fd, "reference"), notes: optStr(fd, "notes"), allocations: allocs });
  await prisma.attachment.create({ data: { ...stored, entityType: "Payment", entityId: p.id, partnerId: user.partnerId, category: "PROOF_OF_PAYMENT", uploadedById: user.id } });
  return { redirect: "/portal/invoices?submitted=1" };
});
export const partnerExpenseAction = safeAction(async (fd) => {
  const user = await requirePartnerAction();
  await submitPartnerExpense(user, { partnerId: user.partnerId, expenseDate: date(fd, "expenseDate", "Date"), category: str(fd, "category", "Category"), description: str(fd, "description", "Description"), amount: amount(fd, "amount", "Amount"), paidBy: "PARTNER" });
  return { revalidate: ["/portal/expenses"], message: "Expense submitted for approval." };
});
export const partnerProblemAction = safeAction(async (fd) => {
  const user = await requirePartnerAction();
  await reportMachineProblem(user, { machineId: str(fd, "machineId"), description: str(fd, "description", "Description"), type: "PROBLEM_REPORT" });
  return { revalidate: ["/portal/machine"], message: "Problem reported. Our operations team has been notified." };
});
