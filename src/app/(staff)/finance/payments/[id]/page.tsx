import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { D, Decimal } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { balanceOf } from "@/lib/calc/payments";
import { Card, DL, PageHeader, Peso, StatusBadge, humanize } from "@/components/ui";
import { ActionForm, ConfirmAction, PrintButton, SubmitButton } from "@/components/forms";
import { Attachments } from "@/components/attachments";
import { allocatePaymentAction, verifyPaymentAction, voidPaymentAction } from "../../actions";

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("finance:read");
  const p = await prisma.payment.findUnique({ where: { id: (await params).id }, include: { allocations: { include: { invoice: true, bill: true } }, partner: true, contact: true } });
  if (!p) notFound();
  const applied = p.allocations.reduce((a, x) => a.plus(D(x.amount)), new Decimal(0));
  const unapplied = D(p.amount).minus(applied);
  const openDocs = p.status === "CONFIRMED" && unapplied.gt(0)
    ? p.direction === "IN"
      ? (await prisma.invoice.findMany({ where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] }, ...(p.partnerId ? { partnerId: p.partnerId } : p.contactId ? { contactId: p.contactId } : { id: "none" }) } })).map((d) => ({ id: d.id, number: d.number, balance: balanceOf(d) }))
      : (await prisma.bill.findMany({ where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] }, ...(p.partnerId ? { partnerId: p.partnerId } : p.contactId ? { contactId: p.contactId } : { payeeName: p.partyName }) } })).map((d) => ({ id: d.id, number: d.number, balance: balanceOf(d) }))
    : [];
  return (
    <div>
      <PageHeader title={`${p.direction === "IN" ? "Receipt" : "Payment voucher"} ${p.number}`} back={{ href: "/finance/payments", label: "Payments" }} subtitle={<StatusBadge status={p.status} />} actions={<>
        <PrintButton label="Print receipt" />
        {p.status === "CONFIRMED" && <a className="btn-secondary" href={`/api/pdf/receipt/${p.id}`}>Download PDF</a>}
        {p.status === "PENDING_VERIFICATION" && can(user.role, "payments:verify") && <>
          <ConfirmAction action={verifyPaymentAction} label="Verify & apply" title="Confirm this payment?" description="Check the proof of payment and that funds were received. The amounts will be applied to the selected invoices." hidden={{ id: p.id, decision: "approve" }} variant="success" reasonLabel="Notes (optional)" />
          <ConfirmAction action={verifyPaymentAction} label="Reject" title="Reject this payment?" hidden={{ id: p.id, decision: "reject" }} variant="danger" reasonLabel="Reason (shown to partner)" reasonRequired />
        </>}
        {p.status === "CONFIRMED" && can(user.role, "payments:verify") && <ConfirmAction action={voidPaymentAction} label="Void" title="Void payment?" description="Applied amounts are reversed and invoice/bill balances restored. The payment stays on record." hidden={{ id: p.id }} variant="danger" reasonLabel="Reason" reasonRequired />}
      </>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Payment" className="lg:col-span-2">
          <div className="mb-4 text-center"><p className="text-xs uppercase tracking-widest text-choco-500">SCOOP MASTER · {p.direction === "IN" ? "Official receipt" : "Payment voucher"}</p><p className="mt-1 text-3xl font-bold"><Peso v={p.amount} /></p></div>
          <DL cols={3} items={[
            [p.direction === "IN" ? "Received from" : "Paid to", p.partner ? <Link key="p" className="link" href={`/partners/${p.partner.id}`}>{p.partyName}</Link> : p.partyName], ["Date", fmtDate(p.paymentDate)], ["Method", humanize(p.method)],
            ["Reference", p.reference], ["Recorded", fmtDateTime(p.createdAt)], ["Verified", fmtDateTime(p.verifiedAt)], ["Notes", p.notes], ["Void / reject reason", p.voidReason],
          ]} />
        </Card>
        <Card title="Application">
          <div className="space-y-1 text-sm">
            {p.allocations.map((a) => <div key={a.id} className="flex justify-between">{a.invoice ? <Link className="link" href={`/finance/invoices/${a.invoice.id}`}>{a.invoice.number}</Link> : a.bill ? <Link className="link" href={`/finance/bills/${a.bill.id}`}>{a.bill.number}</Link> : "—"}<Peso v={a.amount} /></div>)}
            <div className="flex justify-between border-t border-choco-100 pt-2 font-semibold"><span>{p.status === "PENDING_VERIFICATION" ? "Proposed" : "Applied"}</span><Peso v={applied} /></div>
            <div className="flex justify-between"><span>Unapplied credit</span><Peso v={unapplied} /></div>
          </div>
          {openDocs.length > 0 && can(user.role, "payments:write") && (
            <ActionForm action={allocatePaymentAction} className="mt-4 space-y-2 border-t border-choco-50 pt-3">
              <input type="hidden" name="id" value={p.id} />
              <p className="text-xs font-semibold uppercase text-choco-600">Apply unapplied credit</p>
              {openDocs.map((d) => <label key={d.id} className="flex items-center justify-between gap-2 text-sm">{d.number} <span className="text-xs text-choco-500">bal <Peso v={d.balance} /></span><input className="input w-28 text-right" name={`alloc_${d.id}`} /></label>)}
              <SubmitButton className="btn-secondary btn-sm">Apply</SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>
      <div className="mt-4 max-w-2xl"><Attachments entityType="Payment" entityId={p.id} back={`/finance/payments/${p.id}`} categories={["PROOF_OF_PAYMENT", "RECEIPT"]} title="Proof of payment" /></div>
    </div>
  );
}
