import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { D, formatPHPText, formatQty } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { balanceOf } from "@/lib/calc/payments";
import { buildPDF } from "@/server/export";

const pdf = (buf: Buffer, name: string) => new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}.pdf"`, "Cache-Control": "private, no-store" } });
const notFound = () => new NextResponse("Not found", { status: 404 });

export async function GET(_req: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { type, id } = await params;
  const isPartner = user.role === "PARTNER";

  if (type === "invoice") {
    const inv = await prisma.invoice.findUnique({ where: { id }, include: { lines: true, partner: true, contact: true } });
    if (!inv || (isPartner ? inv.partnerId !== user.partnerId : !can(user.role, "finance:read"))) return notFound();
    return pdf(buildPDF(`Invoice ${inv.number}`, `${inv.type.replace(/_/g, " ")} · Status ${inv.status.replace("_", " ")}`, [
      { pairs: [["Bill to", inv.partner?.businessName ?? inv.contact?.name ?? ""], ["Issue date", fmtDate(inv.issueDate)], ["Due date", fmtDate(inv.dueDate)], ["Terms", inv.paymentTerms ?? ""], ["Description", inv.description]] },
      { columns: [{ label: "Description" }, { label: "Qty", align: "right" }, { label: "Unit price", align: "right" }, { label: "Amount", align: "right" }], rows: inv.lines.map((l) => [l.description, formatQty(l.quantity, 3), formatPHPText(l.unitPrice), formatPHPText(l.lineTotal)]), foot: ["TOTAL", "", "", formatPHPText(inv.amount)] },
      { pairs: [["Amount paid", formatPHPText(inv.amountPaid)], ["Balance due", formatPHPText(balanceOf(inv))]] },
    ]), inv.number);
  }

  if (type === "receipt") {
    const p = await prisma.payment.findUnique({ where: { id }, include: { allocations: { include: { invoice: true, bill: true } } } });
    if (!p || p.status !== "CONFIRMED" || (isPartner ? p.partnerId !== user.partnerId : !can(user.role, "finance:read"))) return notFound();
    return pdf(buildPDF(`${p.direction === "IN" ? "Official Receipt" : "Payment Voucher"} ${p.number}`, `Payment date ${fmtDate(p.paymentDate)}`, [
      { pairs: [[p.direction === "IN" ? "Received from" : "Paid to", p.partyName], ["Amount", formatPHPText(p.amount)], ["Method", p.method.replace("_", " ")], ["Reference", p.reference ?? "—"], ["Notes", p.notes ?? ""]] },
      { heading: "Applied to", columns: [{ label: "Document" }, { label: "Amount applied", align: "right" }], rows: p.allocations.map((a) => [a.invoice?.number ?? a.bill?.number ?? "", formatPHPText(a.amount)]), foot: ["Unapplied", formatPHPText(D(p.amount).minus(p.allocations.reduce((s, a) => s.plus(D(a.amount)), D(0))))] },
      { text: ["This is a system-generated receipt from SCOOP MASTER."] },
    ]), p.number);
  }

  if (type === "settlement") {
    const s = await prisma.settlement.findUnique({ where: { id }, include: { partner: true, contract: true } });
    if (!s || (isPartner ? s.partnerId !== user.partnerId || s.status !== "FINALIZED" : !can(user.role, "settlements:read"))) return notFound();
    const calc = (s.calculation ?? {}) as { salesReports?: { number: string; date: string; net: string }[]; supplies?: { name: string; quantity: string; uom: string; value: string }[]; expenses?: { date: string; description: string; amount: string }[] };
    const net = D(s.netDueToOwner);
    return pdf(buildPDF(`Partnership Settlement ${s.number}`, `${s.partner.businessName} (${s.partner.code}) · ${fmtDate(s.periodStart)} – ${fmtDate(s.periodEnd)} · ${s.status}`, [
      { heading: "Profit computation", pairs: [["Gross sales", formatPHPText(s.grossSales)], ["Less discounts", formatPHPText(D(s.discounts).negated())], ["Less refunds", formatPHPText(D(s.refunds).negated())], ["Net sales", formatPHPText(s.netSales)], ["Less supplies consumed", formatPHPText(D(s.suppliesConsumed).negated())], ["Less approved operating expenses", formatPHPText(D(s.operatingExpenses).negated())], ["Distributable profit", formatPHPText(s.distributableProfit)]] },
      { heading: `Distribution (owner ${s.contract.ownerSharePct}% / partner ${s.contract.partnerSharePct}%, ${s.contract.shareModel.replace(/_/g, " ").toLowerCase()})`, pairs: [["Owner share", formatPHPText(s.ownerShare)], ["Partner share", formatPHPText(s.partnerShare)], [net.gte(0) ? "Partner remits to owner" : "Owner pays partner", formatPHPText(net.abs())]] },
      { heading: "Sales included", columns: [{ label: "Date" }, { label: "Report" }, { label: "Net sales", align: "right" }], rows: (calc.salesReports ?? []).map((r) => [fmtDate(r.date), r.number, formatPHPText(r.net)]) },
      { heading: "Supplies consumed", columns: [{ label: "Item" }, { label: "Quantity", align: "right" }, { label: "Value", align: "right" }], rows: (calc.supplies ?? []).map((x) => [x.name, `${formatQty(x.quantity, 3)} ${x.uom.toLowerCase()}`, formatPHPText(x.value)]) },
      ...(calc.expenses?.length ? [{ heading: "Operating expenses", columns: [{ label: "Date" }, { label: "Description" }, { label: "Amount", align: "right" as const }], rows: calc.expenses.map((e) => [fmtDate(e.date), e.description, formatPHPText(e.amount)]) }] : []),
      { heading: "Separate obligations (not part of this computation)", pairs: [["Supply invoices outstanding", formatPHPText(s.supplyInvoicesOutstanding)], ...(isPartner ? [] : [["Owner supply markup in period", formatPHPText(s.supplyMarkupInPeriod)] as [string, string]])] },
      { text: ["Supplies used were deducted above at their consumed value. Unpaid supply invoices are settled separately and are not deducted again."] },
    ]), s.number);
  }
  return notFound();
}
