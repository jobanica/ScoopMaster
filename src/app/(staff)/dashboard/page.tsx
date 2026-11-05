import Link from "next/link";
import {
  AlertTriangle, ArrowUpRight, Banknote, Boxes, Cog, Download, Eye, HandCoins, IceCreamCone, PiggyBank, Receipt, Search, SlidersHorizontal, Store, TrendingUp, Truck, Users, Wallet, Wrench, XCircle,
} from "lucide-react";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { formatPHP, formatQty } from "@/lib/money";
import { addDays, daysBetween, endOfMonth, fmtDate, startOfMonth, todayDate } from "@/lib/dates";
import { dateParam, one, type SP } from "@/lib/params";
import { balanceOf } from "@/lib/calc/payments";
import { UOM_LABEL } from "@/lib/units";
import { PALETTE } from "@/lib/palette";
import { dashboardData, partnerPerformance, pctChange, periodTotals } from "@/server/services/dashboard";
import { Alert, Badge, Card, Empty, Peso, StatusBadge } from "@/components/ui";
import { BarChartBox, LineChartBox, PieChartBox } from "@/components/charts";
import { KpiCard, MetricCard } from "@/components/dashboard-ui";

export const metadata = { title: "Dashboard" };

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "month", label: "This month" },
  { key: "lastmonth", label: "Last month" },
  { key: "custom", label: "Custom dates" },
] as const;

function resolvePeriod(sp: Record<string, string | string[] | undefined>) {
  const today = todayDate();
  const key = (one(sp.period) ?? (sp.from || sp.to ? "custom" : "month")) as (typeof PERIODS)[number]["key"];
  let from = startOfMonth(today), to = today;
  if (key === "today") from = today;
  if (key === "7d") from = addDays(today, -6);
  if (key === "lastmonth") { from = startOfMonth(addDays(startOfMonth(today), -1)); to = endOfMonth(from); }
  if (key === "custom") { from = dateParam(sp.from) ?? startOfMonth(today); to = dateParam(sp.to) ?? today; }
  const len = daysBetween(from, to) + 1;
  return { key, from, to, prevFrom: addDays(from, -len), prevTo: addDays(from, -1), label: PERIODS.find((p) => p.key === key)?.label ?? "This month" };
}

export default async function DashboardPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePage("dashboard:view");
  const sp = await searchParams;
  const per = resolvePeriod(sp);
  const partnerId = one(sp.partnerId);
  const machineId = one(sp.machineId);
  const area = one(sp.area);
  const pq = one(sp.pq);
  const f = { from: per.from, to: per.to, partnerId, machineId, area };
  const [d, now, before, rows, partners, machines] = await Promise.all([
    dashboardData(f),
    periodTotals(f),
    periodTotals({ ...f, from: per.prevFrom, to: per.prevTo }),
    partnerPerformance(f, pq),
    prisma.partner.findMany({ where: { status: { in: ["ACTIVE", "ON_HOLD"] } }, orderBy: { businessName: "asc" }, select: { id: true, businessName: true } }),
    prisma.machine.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true } }),
  ]);
  const fin = can(user.role, "dashboard:financials");
  const c = d.cards;
  const keep = new URLSearchParams(Object.entries({ period: per.key, from: per.key === "custom" ? fmtDate(per.from) : "", to: per.key === "custom" ? fmtDate(per.to) : "", partnerId: partnerId ?? "", machineId: machineId ?? "", area: area ?? "" }).filter(([, v]) => v));
  const activeFilters = [partnerId && partners.find((p) => p.id === partnerId)?.businessName, machineId && machines.find((m) => m.id === machineId)?.code, area].filter(Boolean) as string[];
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "numeric", hour12: false }).format(new Date()));
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-5">
      {one(sp.denied) && <Alert tone="berry">You do not have access to that page.</Alert>}

      {/* Header + period / filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-choco-900">{greet}, {user.name.split(" ")[0]} 🍦</h1>
          <p className="text-sm text-choco-500">Let&apos;s check your ice cream business · {fmtDate(per.from)} – {fmtDate(per.to)}{activeFilters.length ? ` · ${activeFilters.join(", ")}` : ""}</p>
        </div>
        <form className="no-print flex items-center gap-2">
          <select name="period" defaultValue={per.key} className="input min-w-0 flex-1 rounded-full bg-white py-2 pr-8 font-semibold shadow-card sm:w-auto sm:flex-none">
            {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <details className="relative">
            <summary className={`btn-secondary cursor-pointer list-none rounded-full px-3 shadow-card sm:px-4 [&::-webkit-details-marker]:hidden ${activeFilters.length ? "border-choco-300" : ""}`} aria-label="Filters"><SlidersHorizontal size={15} /><span className="hidden sm:inline">Filters</span>{activeFilters.length ? ` (${activeFilters.length})` : ""}</summary>
            <div className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-2xl border border-choco-50 bg-white p-4 shadow-xl">
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="label">From</span><input className="input" name="from" defaultValue={fmtDate(per.from)} placeholder="DD/MM/YYYY" /></label>
                <label className="block"><span className="label">To</span><input className="input" name="to" defaultValue={fmtDate(per.to)} placeholder="DD/MM/YYYY" /></label>
              </div>
              <p className="-mt-1 text-[11px] text-choco-400">Dates apply when the period is “Custom dates”.</p>
              <label className="block"><span className="label">Partner</span><select className="input" name="partnerId" defaultValue={partnerId ?? ""}><option value="">All partners</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.businessName}</option>)}</select></label>
              <label className="block"><span className="label">Machine</span><select className="input" name="machineId" defaultValue={machineId ?? ""}><option value="">All machines</option>{machines.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}</select></label>
              <label className="block"><span className="label">Location / area</span><input className="input" name="area" defaultValue={area ?? ""} placeholder="e.g. Quezon City" /></label>
              <div className="flex gap-2"><button className="btn-primary flex-1 rounded-full" type="submit">Apply</button><Link href="/dashboard" className="btn-secondary rounded-full">Reset</Link></div>
            </div>
          </details>
          <button className="btn-primary rounded-full shadow-card" type="submit">Apply</button>
        </form>
      </div>

      {/* Top summary cards */}
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0">
        <KpiCard icon={<Banknote size={22} />} tone="cream" label="Sales today" value={formatPHP(c.salesToday)} hint={`${c.activePartners} active partner${c.activePartners === 1 ? "" : "s"}`} href="/sales" />
        <KpiCard icon={<AlertTriangle size={22} />} tone="vanilla" label="Low-stock items" value={d.lowStock.length} hint="Warehouse below minimum" href="/inventory?low=1" />
        {fin
          ? <KpiCard icon={<XCircle size={22} />} tone="berry" label="Overdue payments" value={formatPHP(c.overdueAmount)} hint={`${d.overdue.length} invoice${d.overdue.length === 1 ? "" : "s"} past due`} href="/collections" />
          : <KpiCard icon={<Wrench size={22} />} tone="berry" label="Under maintenance" value={c.machinesMaintenance} hint={`${c.machinesDeployed} machines deployed`} href="/machines?status=UNDER_MAINTENANCE" />}
      </div>

      {/* Metric grid */}
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-4">
        {fin ? <>
          <MetricCard highlight label="My partnership income" value={formatPHP(now.ownerIncome)} icon={<PiggyBank size={19} />} trend={pctChange(now.ownerIncome, before.ownerIncome)} href="/settlements" />
          <MetricCard label="Supply markup income" value={formatPHP(now.supplyMarkup)} icon={<Truck size={18} />} trend={pctChange(now.supplyMarkup, before.supplyMarkup)} href="/reports/supply-markup" />
          <MetricCard label="Partner sales" value={formatPHP(now.sales)} icon={<Receipt size={18} />} trend={pctChange(now.sales, before.sales)} href="/sales" />
          <MetricCard label="Gross profit (partners)" value={formatPHP(now.grossProfit)} icon={<TrendingUp size={18} />} trend={pctChange(now.grossProfit, before.grossProfit)} href="/reports/sales-by-partner" />
          <MetricCard label="Partner earnings" value={formatPHP(now.partnerEarnings)} icon={<Users size={18} />} trend={pctChange(now.partnerEarnings, before.partnerEarnings)} href="/reports/partner-shares" />
          <MetricCard label="Receivables outstanding" value={formatPHP(c.receivables)} icon={<HandCoins size={18} />} sub={c.overdueAmount.gt(0) ? `${formatPHP(c.overdueAmount)} overdue` : "None overdue"} href="/finance/receivables" />
          <MetricCard label="Payables outstanding" value={formatPHP(c.payables)} icon={<Wallet size={18} />} sub="Bills to pay" href="/finance/payables" />
          <MetricCard label="Inventory value (cost)" value={formatPHP(c.inventoryValue)} icon={<Boxes size={18} />} sub={`Warehouse ${formatPHP(c.warehouseValue)}`} href="/inventory" />
        </> : <>
          <MetricCard highlight label="Partner sales" value={formatPHP(now.sales)} icon={<Receipt size={19} />} trend={pctChange(now.sales, before.sales)} href="/sales" />
          <MetricCard label="Units sold" value={now.units.toLocaleString("en-PH")} icon={<IceCreamCone size={18} />} trend={pctChange(now.units, before.units)} href="/sales" />
          <MetricCard label="Active partners" value={c.activePartners} icon={<Store size={18} />} sub={`${now.reports} reports this period`} href="/partners?status=ACTIVE" />
          <MetricCard label="Machines deployed" value={c.machinesDeployed} icon={<Cog size={18} />} sub={`${c.machinesAvailable} available · ${c.machinesMaintenance} in maintenance`} href="/machines" />
        </>}
      </div>

      {/* Partner performance table */}
      <Card pad={false}>
        <div className="flex flex-col gap-3 border-b border-choco-50 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div><h2 className="text-base font-bold text-choco-900">Partner performance</h2><p className="text-xs text-choco-500">{per.label} · sorted by sales</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <form className="relative">
              {[...keep.entries()].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-choco-300" />
              <input name="pq" type="search" defaultValue={pq} placeholder="Search partner…" className="input w-48 rounded-full py-2 pl-9" />
            </form>
            {can(user.role, "reports:view") && <a className="btn-secondary rounded-full" href={`/api/reports/sales-by-partner?from=${fmtDate(per.from)}&to=${fmtDate(per.to)}&format=xlsx`}><Download size={15} /> Export</a>}
            {can(user.role, "partners:write") && <Link className="btn-primary rounded-full bg-vanilla-400 text-choco-900 hover:bg-vanilla-500" href="/partners/new">+ Add partner</Link>}
          </div>
        </div>
        {rows.length === 0 ? <div className="p-5"><Empty>No partners match.</Empty></div> : (
          <div className="table-wrap p-2">
            <table className="tbl tbl-stack">
              <thead><tr className="[&>th]:bg-cream-100 [&>th:first-child]:rounded-l-xl [&>th:last-child]:rounded-r-xl [&>th]:border-0"><th>Partner ID</th><th>Partner</th><th>Machine</th><th className="num">Sales</th>{fin && <th className="num">Gross profit</th>}{fin && <th className="num">Owes me</th>}<th>Last report</th><th>Status</th><th className="text-center">Action</th></tr></thead>
              <tbody>{rows.slice(0, 8).map((r) => (
                <tr key={r.partner.id}>
                  <td data-label="ID" className="font-mono text-xs text-choco-500">{r.partner.code}</td>
                  <td className="stack-title"><Link className="font-semibold text-choco-900 hover:underline" href={`/partners/${r.partner.id}`}>{r.partner.businessName}</Link>{r.partner.area && <span className="ml-1 text-xs font-normal text-choco-400">{r.partner.area}</span>}</td>
                  <td data-label="Machine" className="text-xs">{r.partner.machines.map((m) => m.code).join(", ") || "—"}</td>
                  <td data-label="Sales" className="num font-semibold"><Peso v={r.sales} /></td>
                  {fin && <td data-label="Gross profit" className="num"><Peso v={r.profit} /></td>}
                  {fin && <td data-label="Owes me" className="num"><Peso v={r.owed} /></td>}
                  <td data-label="Last report" className="text-xs">{r.lastReport ? fmtDate(r.lastReport) : <span className="text-choco-400">none</span>}</td>
                  <td data-label="Status">{fin && r.overdue.gt(0) ? <Badge tone="berry">Overdue</Badge> : <StatusBadge status={r.partner.status} />}</td>
                  <td data-label="" className="text-center"><Link href={`/partners/${r.partner.id}`} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-choco-500 hover:bg-cream-100 hover:text-choco-900" aria-label={`View ${r.partner.businessName}`}><Eye size={16} /></Link></td>
                </tr>
              ))}</tbody>
            </table>
            <div className="flex items-center justify-between px-3 pb-2 pt-3 text-xs text-choco-500">
              <span>Showing {Math.min(8, rows.length)} of {rows.length} partner{rows.length === 1 ? "" : "s"}</span>
              <Link href="/partners" className="inline-flex items-center gap-1 rounded-full bg-choco-800 px-3 py-1.5 font-semibold text-cream-50 hover:bg-choco-700">View all <ArrowUpRight size={13} /></Link>
            </div>
          </div>
        )}
      </Card>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Daily sales"><BarChartBox data={d.charts.daily} x="date" series={[{ key: "sales", label: "Net sales", color: PALETTE[0] }]} /></Card>
        <Card title="Monthly sales (12 months)"><BarChartBox data={d.charts.monthly} x="month" series={[{ key: "sales", label: "Net sales", color: PALETTE[1] }]} /></Card>
        {fin && <Card title="Profit trends" className="lg:col-span-2">
          <LineChartBox data={d.charts.monthly} x="month" series={[
            { key: "grossProfit", label: "Partner gross profit (est.)", color: PALETTE[2] },
            { key: "ownerIncome", label: "My partnership income", color: PALETTE[0] },
            { key: "supplyMarkup", label: "My supply markup", color: PALETTE[3] },
            { key: "partnerEarnings", label: "Partner earnings", color: PALETTE[4] },
          ]} />
        </Card>}
        <Card title="Sales per partner"><BarChartBox data={d.charts.byPartner} x="name" horizontal series={[{ key: "sales", label: "Net sales", color: PALETTE[0] }]} /></Card>
        <Card title="Profit per machine (est. gross profit)"><BarChartBox data={d.charts.byMachine} x="name" series={[{ key: "sales", label: "Sales", color: PALETTE[5] }, { key: "profit", label: "Gross profit", color: PALETTE[2] }]} /></Card>
        <Card title="Supply consumption by category"><PieChartBox data={d.charts.consumption} /></Card>
        {fin && <Card title="Outstanding balances by age"><BarChartBox data={d.charts.aging} x="bucket" series={[{ key: "receivable", label: "Receivable", color: PALETTE[2] }, { key: "payable", label: "Payable", color: PALETTE[1] }]} /></Card>}
      </div>

      {/* Action lists */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Low-stock alerts (warehouse)" actions={<Link className="link text-xs" href="/inventory?low=1">View all</Link>} pad={false}>
          {d.lowStock.length === 0 ? <div className="p-5"><Empty>All items above minimum.</Empty></div> : (
            <table className="tbl"><tbody>{d.lowStock.map((l) => (
              <tr key={l.item.id}><td><Link className="link" href={`/inventory/items/${l.item.id}`}>{l.item.name}</Link></td><td className="num text-berry-700">{formatQty(l.onHand)} {UOM_LABEL[l.item.uom]}</td><td className="num text-xs text-choco-500">min {formatQty(l.item.minStock)}</td></tr>
            ))}</tbody></table>
          )}
        </Card>
        {fin && <Card title="Overdue payments" actions={<Link className="link text-xs" href="/collections">Collections</Link>} pad={false}>
          {d.overdue.length === 0 ? <div className="p-5"><Empty>Nothing overdue. 🎉</Empty></div> : (
            <table className="tbl"><tbody>{d.overdue.map((i) => (
              <tr key={i.id}><td><Link className="link" href={`/finance/invoices/${i.id}`}>{i.number}</Link><div className="text-xs text-choco-500">{i.partner?.businessName ?? i.contact?.name}</div></td><td className="num"><Peso v={balanceOf(i)} /><div className="text-xs text-berry-700">due {fmtDate(i.dueDate)}</div></td></tr>
            ))}</tbody></table>
          )}
        </Card>}
        {fin && <Card title="Upcoming collections (7 days)" pad={false}>
          {d.upcoming.length === 0 ? <div className="p-5"><Empty>No collections due this week.</Empty></div> : (
            <table className="tbl"><tbody>{d.upcoming.map((i) => (
              <tr key={i.id}><td><Link className="link" href={`/finance/invoices/${i.id}`}>{i.number}</Link><div className="text-xs text-choco-500">{i.partner?.businessName ?? i.contact?.name}</div></td><td className="num"><Peso v={balanceOf(i)} /><div className="text-xs text-choco-500">due {fmtDate(i.dueDate)}</div></td></tr>
            ))}</tbody></table>
          )}
        </Card>}
      </div>
    </div>
  );
}
