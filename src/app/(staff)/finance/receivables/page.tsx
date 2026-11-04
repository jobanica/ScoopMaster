import Link from "next/link";
import type { InvoiceType, Prisma } from "@prisma/client";
import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Decimal, formatPHP } from "@/lib/money";
import { fmtDate, todayDate } from "@/lib/dates";
import { one, type SP } from "@/lib/params";
import { balanceOf, effectiveStatus } from "@/lib/calc/payments";
import { Card, Empty, FilterBar, FilterField, PageHeader, Peso, StatusBadge, humanize } from "@/components/ui";
import { FinanceTabs } from "../tabs";

export const metadata = { title: "Receivables" };
const TYPES: InvoiceType[] = ["SUPPLY", "PARTNERSHIP_SHARE", "MACHINE_SALE", "MACHINE_RENTAL", "INSTALLMENT", "OTHER"];

export default async function ReceivablesPage({ searchParams }: { searchParams: SP }) {
  await requirePage("finance:read");
  const sp = await searchParams;
  const status = one(sp.status) ?? "OPEN";
  const type = one(sp.type) as InvoiceType | undefined;
  const partnerId = one(sp.partnerId);
  const today = todayDate();
  const where: Prisma.InvoiceWhereInput = {
    ...(status === "OPEN" || status === "OVERDUE" ? { status: { in: ["UNPAID", "PARTIALLY_PAID"] } } : status !== "ALL" ? { status: status as never } : {}),
    ...(status === "OVERDUE" ? { dueDate: { lt: today } } : {}),
    ...(type && TYPES.includes(type) ? { type } : {}), ...(partnerId ? { partnerId } : {}),
  };
  const [rows, partners] = await Promise.all([
    prisma.invoice.findMany({ where, include: { partner: true, contact: true }, orderBy: { dueDate: "asc" }, take: 300 }),
    prisma.partner.findMany({ orderBy: { businessName: "asc" }, select: { id: true, businessName: true } }),
  ]);
  const total = rows.reduce((a, r) => a.plus(balanceOf(r)), new Decimal(0));
  return (
    <div>
      <PageHeader title="Finance" />
      <FinanceTabs active="receivables" />
      <FilterBar>
        <FilterField label="Status"><select className="input" name="status" defaultValue={status}>{["OPEN", "OVERDUE", "UNPAID", "PARTIALLY_PAID", "PAID", "CANCELLED", "ALL"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></FilterField>
        <FilterField label="Type"><select className="input" name="type" defaultValue={type ?? ""}><option value="">All</option>{TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></FilterField>
        <FilterField label="Partner"><select className="input" name="partnerId" defaultValue={partnerId ?? ""}><option value="">All</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.businessName}</option>)}</select></FilterField>
      </FilterBar>
      <Card title={`Accounts receivable · ${formatPHP(total)} outstanding`} pad={false}>
        {rows.length === 0 ? <div className="p-5"><Empty /></div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Invoice</th><th>Owed by</th><th>Type</th><th>Description</th><th>Issued</th><th>Due</th><th>Status</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Balance</th></tr></thead>
            <tbody>{rows.map((i) => (
              <tr key={i.id}><td><Link className="link" href={`/finance/invoices/${i.id}`}>{i.number}</Link></td><td>{i.partner?.businessName ?? i.contact?.name}</td><td className="text-xs">{humanize(i.type)}</td><td className="max-w-xs truncate text-xs">{i.description}</td><td>{fmtDate(i.issueDate)}</td><td>{fmtDate(i.dueDate)}</td><td><StatusBadge status={effectiveStatus(i, today)} /></td><td className="num"><Peso v={i.amount} /></td><td className="num"><Peso v={i.amountPaid} /></td><td className="num font-semibold"><Peso v={balanceOf(i)} /></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
