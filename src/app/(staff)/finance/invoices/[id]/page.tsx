import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { formatQty } from "@/lib/money";
import { fmtDate, fmtDateTime, todayDate } from "@/lib/dates";
import { balanceOf, effectiveStatus } from "@/lib/calc/payments";
import { Card, DL, LinkButton, PageHeader, Peso, StatusBadge, humanize } from "@/components/ui";
import { ConfirmAction, PrintButton } from "@/components/forms";
import { Attachments } from "@/components/attachments";
import { PaymentHistory } from "../../doc-parts";
import { cancelInvoiceAction } from "../../actions";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("finance:read");
  const inv = await prisma.invoice.findUnique({ where: { id: (await params).id }, include: { partner: true, contact: true, lines: true, supplyOrder: true, settlement: true } });
  if (!inv) notFound();
  const st = effectiveStatus(inv, todayDate());
  const bal = balanceOf(inv);
  const isSupply = inv.type === "SUPPLY";
  return (
    <div>
      <PageHeader title={`Invoice ${inv.number}`} back={{ href: "/finance/receivables", label: "Receivables" }} subtitle={<span>{humanize(inv.type)} · <StatusBadge status={st} /></span>} actions={<>
        <PrintButton />
        <a className="btn-secondary" href={`/api/pdf/invoice/${inv.id}`}>Download PDF</a>
        {can(user.role, "payments:write") && bal.gt(0) && inv.status !== "CANCELLED" && <LinkButton href={`/finance/payments/new?direction=IN&${inv.partnerId ? `partnerId=${inv.partnerId}` : `contactId=${inv.contactId}`}&invoiceId=${inv.id}`}>Record payment</LinkButton>}
        {can(user.role, "finance:write") && inv.status !== "CANCELLED" && !isSupply && !inv.settlementId && <ConfirmAction action={cancelInvoiceAction} label="Cancel" title="Cancel invoice?" description="Cancelled invoices remain on record for audit." hidden={{ id: inv.id }} variant="danger" reasonLabel="Reason" reasonRequired />}
      </>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <DL cols={3} items={[
            ["Bill to", inv.partner ? <Link key="p" className="link" href={`/partners/${inv.partner.id}`}>{inv.partner.businessName}</Link> : inv.contact?.name], ["Issue date", fmtDate(inv.issueDate)], ["Due date", fmtDate(inv.dueDate)],
            ["Payment terms", inv.paymentTerms], ["Description", inv.description],
            ["Source", inv.supplyOrder ? <Link key="s" className="link" href={`/supply-orders/${inv.supplyOrder.id}`}>Supply order {inv.supplyOrder.number}</Link> : inv.settlement ? <Link key="t" className="link" href={`/settlements/${inv.settlement.id}`}>Settlement {inv.settlement.number}</Link> : "Manual"],
            ["Created", fmtDateTime(inv.createdAt)], ["Cancelled", inv.cancelledAt ? `${fmtDateTime(inv.cancelledAt)} – ${inv.cancelReason}` : "—"],
          ]} />
        </Card>
        <Card title="Balance">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Amount</span><Peso v={inv.amount} /></div>
            <div className="flex justify-between"><span>Paid</span><Peso v={inv.amountPaid} /></div>
            <div className="flex justify-between border-t border-choco-100 pt-2 text-lg font-bold"><span>Outstanding</span><Peso v={bal} /></div>
            {isSupply && <div className="flex justify-between pt-2 text-mint-700"><span>My markup on this invoice</span><Peso v={inv.amount.minus(inv.costAmount)} /></div>}
          </div>
        </Card>
      </div>
      <Card title="Lines" className="mt-4" pad={false}>
        <table className="tbl"><thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th>{isSupply && <th className="num">Unit cost</th>}<th className="num">Total</th></tr></thead>
          <tbody>{inv.lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="num">{formatQty(l.quantity, 3)}</td><td className="num"><Peso v={l.unitPrice} /></td>{isSupply && <td className="num"><Peso v={l.unitCost} /></td>}<td className="num"><Peso v={l.lineTotal} /></td></tr>)}</tbody></table>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <PaymentHistory invoiceId={inv.id} />
        <Attachments entityType="Invoice" entityId={inv.id} back={`/finance/invoices/${inv.id}`} />
      </div>
    </div>
  );
}
