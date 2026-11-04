import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { D, Decimal, formatPHP } from "@/lib/money";
import { addDays, fmtDate, startOfMonth, todayDate } from "@/lib/dates";
import { balanceOf } from "@/lib/calc/payments";
import { Card, Empty, PageHeader, Peso, Stat, humanize } from "@/components/ui";

export const metadata = { title: "Collections" };
export default async function CollectionsPage() {
  await requirePage("finance:read");
  const today = todayDate();
  const [todayIn, monthIn, open, history] = await Promise.all([
    prisma.payment.aggregate({ where: { direction: "IN", status: "CONFIRMED", paymentDate: today }, _sum: { amount: true }, _count: true }),
    prisma.payment.aggregate({ where: { direction: "IN", status: "CONFIRMED", paymentDate: { gte: startOfMonth(today), lte: today } }, _sum: { amount: true }, _count: true }),
    prisma.invoice.findMany({ where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } }, include: { partner: true, contact: true }, orderBy: { dueDate: "asc" } }),
    prisma.payment.findMany({ where: { direction: "IN" }, orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }], take: 25 }),
  ]);
  const overdue = open.filter((i) => i.dueDate < today);
  const upcoming = open.filter((i) => i.dueDate >= today && i.dueDate <= addDays(today, 14));
  const byParty = new Map<string, { name: string; href: string; total: Decimal; overdue: Decimal; oldest: Date }>();
  for (const i of overdue) {
    const key = i.partnerId ?? i.contactId ?? i.id;
    const row = byParty.get(key) ?? { name: i.partner?.businessName ?? i.contact?.name ?? "—", href: i.partnerId ? `/partners/${i.partnerId}?tab=balances` : `/finance/receivables`, total: new Decimal(0), overdue: new Decimal(0), oldest: i.dueDate };
    row.overdue = row.overdue.plus(balanceOf(i));
    if (i.dueDate < row.oldest) row.oldest = i.dueDate;
    byParty.set(key, row);
  }
  const sum = (rows: typeof open) => rows.reduce((a, r) => a.plus(balanceOf(r)), new Decimal(0));
  const table = (rows: typeof open) => rows.length === 0 ? <div className="p-5"><Empty /></div> : (
    <div className="table-wrap"><table className="tbl"><thead><tr><th>Invoice</th><th>From</th><th>Type</th><th>Due</th><th className="num">Balance</th><th></th></tr></thead>
      <tbody>{rows.map((i) => <tr key={i.id}><td><Link className="link" href={`/finance/invoices/${i.id}`}>{i.number}</Link></td><td>{i.partner?.businessName ?? i.contact?.name}</td><td className="text-xs">{humanize(i.type)}</td><td>{fmtDate(i.dueDate)}</td><td className="num"><Peso v={balanceOf(i)} /></td>
        <td><Link className="btn-secondary btn-sm" href={`/finance/payments/new?direction=IN&${i.partnerId ? `partnerId=${i.partnerId}` : `contactId=${i.contactId}`}&invoiceId=${i.id}`}>Collect</Link></td></tr>)}</tbody></table></div>
  );
  return (
    <div>
      <PageHeader title="Collections" subtitle={`As of ${fmtDate(today)}`} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Collected today" value={formatPHP(todayIn._sum.amount)} hint={`${todayIn._count} payment(s)`} tone="mint" />
        <Stat label="Collected this month" value={formatPHP(monthIn._sum.amount)} hint={`${monthIn._count} payment(s)`} tone="mint" />
        <Stat label="Unpaid invoices" value={formatPHP(sum(open))} hint={`${open.length} invoice(s)`} tone="vanilla" />
        <Stat label="Overdue accounts" value={formatPHP(sum(overdue))} hint={`${byParty.size} account(s)`} tone="berry" />
        <Stat label="Due in 14 days" value={formatPHP(sum(upcoming))} hint={`${upcoming.length} invoice(s)`} tone="sky" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Overdue accounts" pad={false}>
          {byParty.size === 0 ? <div className="p-5"><Empty>No overdue accounts.</Empty></div> : (
            <table className="tbl"><thead><tr><th>Account</th><th>Oldest due</th><th className="num">Days</th><th className="num">Overdue</th></tr></thead>
              <tbody>{[...byParty.values()].sort((a, b) => b.overdue.comparedTo(a.overdue)).map((r) => <tr key={r.name}><td><Link className="link" href={r.href}>{r.name}</Link></td><td>{fmtDate(r.oldest)}</td><td className="num text-berry-700">{Math.round((today.getTime() - r.oldest.getTime()) / 86400000)}</td><td className="num font-semibold"><Peso v={r.overdue} /></td></tr>)}</tbody></table>
          )}
        </Card>
        <Card title="Upcoming collections (14 days)" pad={false}>{table(upcoming)}</Card>
        <Card title="Overdue invoices" pad={false}>{table(overdue)}</Card>
        <Card title="Collection history" pad={false}>
          {history.length === 0 ? <div className="p-5"><Empty /></div> : (
            <table className="tbl"><tbody>{history.map((p) => <tr key={p.id} className={p.status === "CONFIRMED" ? "" : "opacity-60"}><td><Link className="link" href={`/finance/payments/${p.id}`}>{p.number}</Link><div className="text-xs text-choco-500">{humanize(p.status)}</div></td><td>{p.partyName}</td><td>{fmtDate(p.paymentDate)}</td><td>{humanize(p.method)}</td><td className="num"><Peso v={D(p.amount)} /></td></tr>)}</tbody></table>
          )}
        </Card>
      </div>
    </div>
  );
}
