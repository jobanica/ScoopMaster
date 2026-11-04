import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDateTime, todayDate } from "@/lib/dates";
import { balanceOf, effectiveStatus } from "@/lib/calc/payments";
import { Card, DL, LinkButton, PageHeader, Peso, StatusBadge, humanize } from "@/components/ui";
import { ConfirmAction } from "@/components/forms";
import { Attachments } from "@/components/attachments";
import { PaymentHistory } from "../../doc-parts";
import { cancelBillAction } from "../../actions";

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("finance:read");
  const b = await prisma.bill.findUnique({ where: { id: (await params).id }, include: { contact: true, partner: true, settlement: true, maintenance: { include: { machine: true } } } });
  if (!b) notFound();
  const bal = balanceOf(b);
  return (
    <div>
      <PageHeader title={`Bill ${b.number}`} back={{ href: "/finance/payables", label: "Payables" }} subtitle={<span>{humanize(b.category)} · <StatusBadge status={effectiveStatus(b, todayDate())} /></span>} actions={<>
        {can(user.role, "payments:write") && bal.gt(0) && b.status !== "CANCELLED" && <LinkButton href={`/finance/payments/new?direction=OUT&${b.partnerId ? `partnerId=${b.partnerId}` : b.contactId ? `contactId=${b.contactId}` : `payee=${encodeURIComponent(b.payeeName)}`}&billId=${b.id}`}>Record payment</LinkButton>}
        {can(user.role, "finance:write") && b.status !== "CANCELLED" && !b.settlementId && <ConfirmAction action={cancelBillAction} label="Cancel" title="Cancel bill?" hidden={{ id: b.id }} variant="danger" reasonLabel="Reason" reasonRequired />}
      </>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <DL cols={3} items={[
            ["Payee", b.payeeName], ["Bill date", fmtDate(b.billDate)], ["Due date", fmtDate(b.dueDate)], ["Category", humanize(b.category)], ["Terms", b.paymentTerms], ["Description", b.description],
            ["Source", b.settlement ? <Link key="s" className="link" href={`/settlements/${b.settlement.id}`}>Settlement {b.settlement.number}</Link> : b.maintenance ? <Link key="m" className="link" href={`/machines/${b.maintenance.machineId}`}>{b.maintenance.number} ({b.maintenance.machine.code})</Link> : "Manual"],
            ["Created", fmtDateTime(b.createdAt)], ["Cancelled", b.cancelledAt ? `${fmtDateTime(b.cancelledAt)} – ${b.cancelReason}` : "—"],
          ]} />
        </Card>
        <Card title="Balance"><div className="space-y-2 text-sm"><div className="flex justify-between"><span>Amount</span><Peso v={b.amount} /></div><div className="flex justify-between"><span>Paid</span><Peso v={b.amountPaid} /></div><div className="flex justify-between border-t border-choco-100 pt-2 text-lg font-bold"><span>Outstanding</span><Peso v={bal} /></div></div></Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <PaymentHistory billId={b.id} />
        <Attachments entityType="Bill" entityId={b.id} back={`/finance/bills/${b.id}`} categories={["RECEIPT", "INVOICE", "GENERAL"]} />
      </div>
    </div>
  );
}
