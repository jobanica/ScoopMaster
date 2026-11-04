import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { formatPHP, Decimal } from "@/lib/money";
import { rangeParams, type SP } from "@/lib/params";
import { balanceOf } from "@/lib/calc/payments";
import { todayDate } from "@/lib/dates";
import { profitAndLoss, cashFlow } from "@/server/services/accounting";
import { Card, FilterBar, FilterField, LinkButton, PageHeader, Peso, Stat, humanize } from "@/components/ui";
import { FinanceTabs } from "./tabs";

export const metadata = { title: "Finance" };
export default async function FinancePage({ searchParams }: { searchParams: SP }) {
  const user = await requirePage("finance:read");
  const r = rangeParams(await searchParams);
  const today = todayDate();
  const [pl, cf, ar, ap, pending] = await Promise.all([
    profitAndLoss(r.from, r.to), cashFlow(r.from, r.to),
    prisma.invoice.findMany({ where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } } }),
    prisma.bill.findMany({ where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } } }),
    prisma.payment.count({ where: { status: "PENDING_VERIFICATION" } }),
  ]);
  const sumBal = (rows: { amount: unknown; amountPaid: unknown; dueDate: Date }[], overdue = false) => rows.filter((x) => !overdue || x.dueDate < today).reduce((a, x) => a.plus(balanceOf(x as never)), new Decimal(0));
  const line = (label: string, v: Decimal, bold = false, indent = false) => <div className={`flex justify-between py-1 ${bold ? "border-t border-choco-100 font-bold" : ""} ${indent ? "pl-4 text-choco-600" : ""}`}><span>{label}</span><Peso v={v} /></div>;
  return (
    <div>
      <PageHeader title="Finance" subtitle={`${r.fromText} – ${r.toText}`} actions={can(user.role, "finance:write") && <>
        <LinkButton href="/finance/new-bill" variant="secondary">Record expense / bill</LinkButton>
        <LinkButton href="/finance/new-invoice" variant="secondary">Record other income</LinkButton>
        <LinkButton href="/finance/payments/new">Record payment</LinkButton>
      </>} />
      <FinanceTabs active="overview" />
      <FilterBar>
        <FilterField label="From"><input className="input" name="from" defaultValue={r.fromText} /></FilterField>
        <FilterField label="To"><input className="input" name="to" defaultValue={r.toText} /></FilterField>
      </FilterBar>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Receivables outstanding" value={formatPHP(sumBal(ar))} hint={`${formatPHP(sumBal(ar, true))} overdue`} href="/finance/receivables" tone="vanilla" />
        <Stat label="Payables outstanding" value={formatPHP(sumBal(ap))} hint={`${formatPHP(sumBal(ap, true))} overdue`} href="/finance/payables" />
        <Stat label="Net cash flow (period)" value={formatPHP(cf.net)} hint={`In ${formatPHP(cf.inflow)} · Out ${formatPHP(cf.outflow)}`} tone="mint" />
        <Stat label="Payments awaiting verification" value={pending} href="/finance/payments?status=PENDING_VERIFICATION" tone={pending ? "berry" : "mint"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Profit & loss (owner, accrual)" actions={<Link className="link text-xs" href={`/reports/profit-and-loss?from=${r.fromText}&to=${r.toText}`}>Full report</Link>}>
          <div className="text-sm">
            {line("Partnership income (my share)", pl.partnershipIncome, false, true)}
            {line("Supply sales to partners", pl.supplySales, false, true)}
            {line("Machine sales / rentals / installments", pl.machineSales.plus(pl.machineRentals).plus(pl.installments), false, true)}
            {line("Other income", pl.otherIncome, false, true)}
            {line("Total revenue", pl.revenue, true)}
            {line("Cost of supplies sold", pl.costOfSales.negated(), false, true)}
            {line("Gross profit", pl.grossProfit, true)}
            {pl.expenses.map((e) => <div key={e.category}>{line(humanize(e.category), e.amount.negated(), false, true)}</div>)}
            {line("Net income", pl.netIncome, true)}
          </div>
        </Card>
        <Card title="Income streams kept separate">
          <div className="space-y-3 text-sm">
            <div className="rounded-xl bg-mint-50 p-4"><p className="text-xs font-semibold uppercase text-mint-700">Partnership profit share</p><p className="text-2xl font-bold"><Peso v={pl.partnershipIncome} /></p><p className="text-xs text-choco-500">From finalized settlements. Supplies consumed were deducted inside each partnership computation.</p></div>
            <div className="rounded-xl bg-vanilla-50 p-4"><p className="text-xs font-semibold uppercase text-vanilla-700">Supply markup</p><p className="text-2xl font-bold"><Peso v={pl.supplyMarkup} /></p><p className="text-xs text-choco-500">Supply invoices ({formatPHP(pl.supplySales)}) minus my cost ({formatPHP(pl.supplyCost)}). Never added to the profit split.</p></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
