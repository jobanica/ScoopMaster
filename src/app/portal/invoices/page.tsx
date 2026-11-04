import { requirePartner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Decimal, formatPHP } from "@/lib/money";
import { fmtDate, todayDate } from "@/lib/dates";
import { balanceOf, effectiveStatus } from "@/lib/calc/payments";
import { one, type SP } from "@/lib/params";
import { Alert, Card, Empty, LinkButton, PageHeader, Peso, StatusBadge, humanize } from "@/components/ui";

export const metadata = { title: "Invoices & payments" };
export default async function PortalInvoices({ searchParams }: { searchParams: SP }) {
  const user = await requirePartner();
  const submitted = one((await searchParams).submitted);
  const today = todayDate();
  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({ where: { partnerId: user.partnerId, status: { not: "CANCELLED" } }, orderBy: { issueDate: "desc" }, take: 100 }),
    prisma.payment.findMany({ where: { partnerId: user.partnerId, direction: "IN" }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const open = invoices.filter((i) => ["UNPAID", "PARTIALLY_PAID"].includes(i.status));
  const total = open.reduce((a, i) => a.plus(balanceOf(i)), new Decimal(0));
  return (
    <div className="space-y-4">
      <PageHeader title="Invoices & payments" subtitle={`Outstanding ${formatPHP(total)}`} actions={open.length > 0 && <LinkButton href="/portal/payments/new">Submit payment</LinkButton>} />
      {submitted && <Alert tone="mint">Payment submitted. It will be applied once Scoop Master verifies it.</Alert>}
      <Card title="Invoices" pad={false}>
        {invoices.length === 0 ? <div className="p-5"><Empty /></div> : (
          <ul className="divide-y divide-choco-50">{invoices.map((i) => (
            <li key={i.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span><span className="font-semibold">{i.number}</span><span className="block text-xs text-choco-500">{humanize(i.type)} · issued {fmtDate(i.issueDate)} · due {fmtDate(i.dueDate)}</span><a className="link text-xs" href={`/api/pdf/invoice/${i.id}`}>Download PDF</a></span>
              <span className="text-right"><Peso v={balanceOf(i)} className="font-semibold" /><span className="block text-xs text-choco-500">of <Peso v={i.amount} /></span><StatusBadge status={effectiveStatus(i, today)} /></span>
            </li>
          ))}</ul>
        )}
      </Card>
      <Card title="My payments" pad={false}>
        {payments.length === 0 ? <div className="p-5"><Empty /></div> : (
          <ul className="divide-y divide-choco-50">{payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span><span className="font-semibold">{p.number}</span><span className="block text-xs text-choco-500">{fmtDate(p.paymentDate)} · {humanize(p.method)} {p.reference && `· ${p.reference}`}</span>{p.status === "CONFIRMED" && <a className="link text-xs" href={`/api/pdf/receipt/${p.id}`}>Receipt PDF</a>}{p.voidReason && <span className="block text-xs text-berry-700">{p.voidReason}</span>}</span>
              <span className="text-right"><Peso v={p.amount} className="font-semibold" /><div><StatusBadge status={p.status} /></div></span>
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}
