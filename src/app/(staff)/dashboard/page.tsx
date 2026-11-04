import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { formatPHP, formatQty } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { one, rangeParams, type SP } from "@/lib/params";
import { balanceOf } from "@/lib/calc/payments";
import { dashboardData } from "@/server/services/dashboard";
import { Alert, Card, Empty, FilterBar, FilterField, PageHeader, Peso, Stat } from "@/components/ui";
import { BarChartBox, LineChartBox, PieChartBox, PALETTE } from "@/components/charts";
import { UOM_LABEL } from "@/lib/units";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePage("dashboard:view");
  const sp = await searchParams;
  const r = rangeParams(sp);
  const partnerId = one(sp.partnerId);
  const machineId = one(sp.machineId);
  const area = one(sp.area);
  const [d, partners, machines] = await Promise.all([
    dashboardData({ from: r.from, to: r.to, partnerId, machineId, area }),
    prisma.partner.findMany({ where: { status: { in: ["ACTIVE", "ON_HOLD"] } }, orderBy: { businessName: "asc" }, select: { id: true, businessName: true } }),
    prisma.machine.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true } }),
  ]);
  const fin = can(user.role, "dashboard:financials");
  const c = d.cards;

  return (
    <div>
      <PageHeader title={`Good day, ${user.name.split(" ")[0]}`} subtitle={`Business overview · ${r.fromText} – ${r.toText}`} />
      {one(sp.denied) && <Alert tone="berry">You do not have access to that page.</Alert>}
      <FilterBar>
        <FilterField label="From"><input className="input" name="from" defaultValue={r.fromText} placeholder="DD/MM/YYYY" /></FilterField>
        <FilterField label="To"><input className="input" name="to" defaultValue={r.toText} placeholder="DD/MM/YYYY" /></FilterField>
        <FilterField label="Partner">
          <select className="input" name="partnerId" defaultValue={partnerId ?? ""}><option value="">All partners</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.businessName}</option>)}</select>
        </FilterField>
        <FilterField label="Machine">
          <select className="input" name="machineId" defaultValue={machineId ?? ""}><option value="">All machines</option>{machines.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}</select>
        </FilterField>
        <FilterField label="Location / area"><input className="input" name="area" defaultValue={area ?? ""} placeholder="e.g. Quezon City" /></FilterField>
      </FilterBar>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Active partners" value={c.activePartners} href="/partners?status=ACTIVE" />
        <Stat label="Machines deployed" value={c.machinesDeployed} tone="mint" href="/machines?status=DEPLOYED" />
        <Stat label="Machines available" value={c.machinesAvailable} tone="sky" href="/machines?status=AVAILABLE" />
        <Stat label="Under maintenance" value={c.machinesMaintenance} tone="vanilla" href="/machines?status=UNDER_MAINTENANCE" />
        <Stat label="Sales today" value={formatPHP(c.salesToday)} tone="berry" href="/sales" />
        <Stat label="Sales in period" value={formatPHP(c.salesRange)} hint={`${c.reportsInRange} reports · ${c.unitsInRange} units`} tone="berry" />
        {fin && <>
          <Stat label="Est. gross profit (partners)" value={formatPHP(c.grossProfit)} hint="Net sales − theoretical supply cost" tone="mint" />
          <Stat label="My partnership income" value={formatPHP(c.ownerIncome)} hint="Finalized settlements" tone="choco" href="/settlements" />
          <Stat label="My supply markup income" value={formatPHP(c.supplyMarkup)} hint="Reported separately" tone="vanilla" href="/reports/supply-markup" />
          <Stat label="Partner earnings" value={formatPHP(c.partnerEarnings)} tone="sky" />
          <Stat label="Outstanding receivables" value={formatPHP(c.receivables)} hint={c.overdueAmount.gt(0) ? `${formatPHP(c.overdueAmount)} overdue` : "None overdue"} tone={c.overdueAmount.gt(0) ? "berry" : "mint"} href="/finance/receivables" />
          <Stat label="Outstanding payables" value={formatPHP(c.payables)} tone="choco" href="/finance/payables" />
        </>}
        <Stat label="Inventory value (cost)" value={formatPHP(c.inventoryValue)} hint={`Warehouse ${formatPHP(c.warehouseValue)}`} tone="choco" href="/inventory" />
        <Stat label="Low-stock items" value={d.lowStock.length} tone={d.lowStock.length ? "berry" : "mint"} href="/inventory?low=1" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
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
        <Card title="Supply consumption by category (at transfer price)"><PieChartBox data={d.charts.consumption} /></Card>
        {fin && <Card title="Outstanding balances by age"><BarChartBox data={d.charts.aging} x="bucket" series={[{ key: "receivable", label: "Receivable", color: PALETTE[2] }, { key: "payable", label: "Payable", color: PALETTE[1] }]} /></Card>}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
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
