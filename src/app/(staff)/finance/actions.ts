"use server";
import type { ExpenseCategory, InvoiceType, PaymentMethod } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { safeAction } from "@/lib/action";
import { amount, bool, date, oneOf, optDate, optStr, str, email } from "@/lib/form";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { allocatePayment, cancelBill, cancelInvoice, recordExpense, recordIncome, recordPayment, reviewPartnerExpense, saveContact, submitPartnerExpense, verifyPayment, voidPayment } from "@/server/services/finance";

const METHODS = ["CASH", "GCASH", "BANK_TRANSFER", "OTHER"] as const;
const CATS = ["INGREDIENT_PURCHASE", "PACKAGING_PURCHASE", "TRANSPORTATION", "DELIVERY", "MACHINE_REPAIR", "MAINTENANCE", "SALARIES", "MARKETING", "UTILITIES", "RENT", "MACHINE_PURCHASE", "OTHER"] as const;
const INCOME = ["MACHINE_SALE", "MACHINE_RENTAL", "INSTALLMENT", "OTHER"] as const;

function allocations(fd: FormData, key: "invoiceId" | "billId") {
  const out: { invoiceId?: string; billId?: string; amount: string }[] = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("alloc_") || typeof v !== "string" || !v.trim()) continue;
    const amt = v.replace(/[,₱\s]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(amt)) throw new AppError("Allocation amounts must be valid peso amounts.");
    if (Number(amt) === 0) continue;
    out.push({ [key]: k.slice(6), amount: amt });
  }
  return out;
}

async function partyName(partnerId: string | null, contactId: string | null, fallback: string | null) {
  if (partnerId) return (await prisma.partner.findUniqueOrThrow({ where: { id: partnerId } })).businessName;
  if (contactId) return (await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })).name;
  if (!fallback) throw new AppError("Payer / payee name is required.");
  return fallback;
}

export const recordPaymentAction = safeAction(async (fd) => {
  const user = await requireUser("payments:write");
  const direction = oneOf(fd, "direction", ["IN", "OUT"] as const);
  const partnerId = optStr(fd, "partnerId");
  const contactId = optStr(fd, "contactId");
  const p = await recordPayment(user, {
    direction, paymentDate: date(fd, "paymentDate", "Payment date"), amount: amount(fd, "amount", "Amount"), method: oneOf(fd, "method", METHODS) as PaymentMethod,
    reference: optStr(fd, "reference"), partyName: await partyName(partnerId, contactId, optStr(fd, "partyName")), partnerId, contactId, notes: optStr(fd, "notes"),
    allocations: allocations(fd, direction === "IN" ? "invoiceId" : "billId"),
  });
  return `/finance/payments/${p.id}`;
});

export const allocatePaymentAction = safeAction(async (fd) => {
  const user = await requireUser("payments:write");
  const id = str(fd, "id");
  const p = await prisma.payment.findUniqueOrThrow({ where: { id } });
  await allocatePayment(user, id, allocations(fd, p.direction === "IN" ? "invoiceId" : "billId"));
  return { revalidate: [`/finance/payments/${id}`], message: "Payment applied." };
});

export const verifyPaymentAction = safeAction(async (fd) => {
  const user = await requireUser("payments:verify");
  const id = str(fd, "id");
  await verifyPayment(user, id, str(fd, "decision") === "approve", optStr(fd, "reason"));
  return { revalidate: [`/finance/payments/${id}`], message: "Payment reviewed." };
});

export const voidPaymentAction = safeAction(async (fd) => {
  const user = await requireUser("payments:verify");
  const id = str(fd, "id");
  await voidPayment(user, id, str(fd, "reason", "Reason"));
  return { revalidate: [`/finance/payments/${id}`], message: "Payment voided; balances restored." };
});

export const recordExpenseAction = safeAction(async (fd) => {
  const user = await requireUser("finance:write");
  const contactId = optStr(fd, "contactId");
  const billDate = date(fd, "billDate", "Date");
  const paidNow = bool(fd, "paidNow");
  const bill = await recordExpense(user, {
    category: oneOf(fd, "category", CATS, "Category") as ExpenseCategory, contactId, payeeName: await partyName(null, contactId, optStr(fd, "payeeName")),
    description: str(fd, "description", "Description"), billDate, dueDate: optDate(fd, "dueDate", "Due date") ?? billDate, amount: amount(fd, "amount", "Amount"),
    paymentTerms: optStr(fd, "paymentTerms"), paidNow, method: paidNow ? (oneOf(fd, "method", METHODS) as PaymentMethod) : undefined, reference: optStr(fd, "reference"),
  });
  return `/finance/bills/${bill.id}`;
});

export const recordIncomeAction = safeAction(async (fd) => {
  const user = await requireUser("finance:write");
  const partnerId = optStr(fd, "partnerId");
  const contactId = optStr(fd, "contactId");
  if (!partnerId && !contactId) throw new AppError("Choose a partner or contact who owes this amount.");
  const issueDate = date(fd, "issueDate", "Issue date");
  const receivedNow = bool(fd, "receivedNow");
  const inv = await recordIncome(user, {
    type: oneOf(fd, "type", INCOME, "Type") as InvoiceType, partnerId, contactId, description: str(fd, "description", "Description"), issueDate,
    dueDate: optDate(fd, "dueDate", "Due date") ?? issueDate, paymentTerms: optStr(fd, "paymentTerms"),
    lines: [{ description: str(fd, "description", "Description"), quantity: optStr(fd, "quantity") ? amount(fd, "quantity", "Quantity") : "1", unitPrice: amount(fd, "unitPrice", "Amount") }],
    receivedNow, method: receivedNow ? (oneOf(fd, "method", METHODS) as PaymentMethod) : undefined, reference: optStr(fd, "reference"), partyName: await partyName(partnerId, contactId, null),
  });
  return `/finance/invoices/${inv.id}`;
});

export const cancelInvoiceAction = safeAction(async (fd) => {
  const user = await requireUser("finance:write");
  const id = str(fd, "id");
  await cancelInvoice(user, id, str(fd, "reason", "Reason"));
  return { revalidate: [`/finance/invoices/${id}`], message: "Invoice cancelled." };
});

export const cancelBillAction = safeAction(async (fd) => {
  const user = await requireUser("finance:write");
  const id = str(fd, "id");
  await cancelBill(user, id, str(fd, "reason", "Reason"));
  return { revalidate: [`/finance/bills/${id}`], message: "Bill cancelled." };
});

export const saveContactAction = safeAction(async (fd) => {
  const user = await requireUser("finance:write");
  const id = optStr(fd, "id") ?? undefined;
  await saveContact(user, {
    type: oneOf(fd, "type", ["SUPPLIER", "CUSTOMER", "DELIVERY_PROVIDER", "TECHNICIAN", "EMPLOYEE", "INSTALLMENT_BUYER", "OTHER"] as const), name: str(fd, "name", "Name"),
    contactPerson: optStr(fd, "contactPerson"), phone: optStr(fd, "phone"), email: email(fd, "email", { optional: true }), address: optStr(fd, "address"), notes: optStr(fd, "notes"),
  }, id);
  return { revalidate: ["/finance/contacts"], message: "Contact saved." };
});

export const reviewPartnerExpenseAction = safeAction(async (fd) => {
  const user = await requireUser("partnerExpenses:review");
  await reviewPartnerExpense(user, str(fd, "id"), str(fd, "decision") === "approve", optStr(fd, "reason"));
  return { revalidate: ["/finance/partner-expenses"], message: "Expense reviewed." };
});

export const staffPartnerExpenseAction = safeAction(async (fd) => {
  const user = await requireUser("partnerExpenses:review");
  await submitPartnerExpense(user, {
    partnerId: str(fd, "partnerId", "Partner"), expenseDate: date(fd, "expenseDate", "Date"), category: str(fd, "category", "Category"),
    description: str(fd, "description", "Description"), amount: amount(fd, "amount", "Amount"), paidBy: oneOf(fd, "paidBy", ["PARTNER", "OWNER"] as const),
  });
  return { revalidate: ["/finance/partner-expenses"], message: "Expense recorded (pending review)." };
});
