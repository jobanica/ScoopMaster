import Link from "next/link";
import type { ExpenseCategory, Prisma } from "@prisma/client";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Decimal, formatPHP } from "@/lib/money";
import { fmtDate, todayDate } from "@/lib/dates";
import { one, type SP } from "@/lib/params";
import { balanceOf, effectiveStatus } from "@/lib/calc/payments";
import { Card, Empty, FilterBar, FilterField, LinkButton, PageHeader, Peso, StatusBadge, humanize } from "@/components/ui";
import { FinanceTabs } from "../tabs";

export const metadata = { title: "Payables" };
const CATS: ExpenseCategory[] = ["INGREDIENT_PURCHASE", "PACKAGING_PURCHASE", "TRANSPORTATION", "DELIVERY", "MACHINE_REPAIR", "MAINTENANCE", "SALARIES", "MARKETING", "UTILITIES", "RENT", "MACHINE_PURCHASE", "PARTNER_PAYOUT", "OTHER"];

export default async function PayablesPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePage("finance:read");
  const sp = await searchParams;
  const status = one(sp.status) ?? "OPEN";
  const category = one(sp.category) as ExpenseCategory | undefined;
  const today = todayDate();
  const where: Prisma.BillWhereInput = {
    ...(status === "OPEN" || status === "OVERDUE" ? { status: { in: ["UNPAID", "PARTIALLY_PAID"] } } : status !== "ALL" ? { status: status as never } : {}),
    ...(status === "OVERDUE" ? { dueDate: { lt: today } } : {}), ...(category && CATS.includes(category) ? { category } : {}),
  };
  const rows = await prisma.bill.findMany({ where, include: { contact: true }, orderBy: { dueDate: "asc" }, take: 300 });
  const total = rows.reduce((a, r) => a.plus(balanceOf(r)), new Decimal(0));
  return (
    <div>
      <PageHeader title="Finance" actions={can(user.role, "finance:write") && <LinkButton href="/finance/new-bill">+ Record expense / bill</LinkButton>} />
      <FinanceTabs active="payables" />
      <FilterBar>
        <FilterField label="Status"><select className="input" name="status" defaultValue={status}>{["OPEN", "OVERDUE", "UNPAID", "PARTIALLY_PAID", "PAID", "CANCELLED", "ALL"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></FilterField>
        <FilterField label="Category"><select className="input" name="category" defaultValue={category ?? ""}><option value="">All</option>{CATS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></FilterField>
      </FilterBar>
      <Card title={`Accounts payable · ${formatPHP(total)} outstanding`} pad={false}>
        {rows.length === 0 ? <div className="p-5"><Empty /></div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Bill</th><th>Payee</th><th>Category</th><th>Description</th><th>Date</th><th>Due</th><th>Status</th><th className="num">Amount</th><th className="num">Balance</th></tr></thead>
            <tbody>{rows.map((b) => (
              <tr key={b.id}><td><Link className="link" href={`/finance/bills/${b.id}`}>{b.number}</Link></td><td>{b.payeeName}</td><td className="text-xs">{humanize(b.category)}</td><td className="max-w-xs truncate text-xs">{b.description}</td><td>{fmtDate(b.billDate)}</td><td>{fmtDate(b.dueDate)}</td><td><StatusBadge status={effectiveStatus(b, today)} /></td><td className="num"><Peso v={b.amount} /></td><td className="num font-semibold"><Peso v={balanceOf(b)} /></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
