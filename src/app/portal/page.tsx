import Link from "next/link";
import { requirePartner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { D, Decimal, formatPHP } from "@/lib/money";
import { addDays, fmtDate, startOfMonth, todayDate } from "@/lib/dates";
import { balanceOf } from "@/lib/calc/payments";
import { UOM_LABEL } from "@/lib/units";
import { Alert, Card, Peso, Stat } from "@/components/ui";
import { contractOn } from "@/server/services/partners";
import { openShiftFor } from "@/server/services/shifts";
import { fmtDateTime } from "@/lib/dates";
import { one, type SP } from "@/lib/params";
import { BarChartBox } from "@/components/charts";
import { PALETTE } from "@/lib/palette";

export const metadata = { title: "My dashboard" };
export default async function PortalHome({ searchParams }: { searchParams: SP }) {
  const user = await requirePartner();
  const pid = user.partnerId;
  const today = todayDate();
  const [partner, todayReport, mtd, last14, invoices, levels, statement, machines] = await Promise.all([
    prisma.partner.findUniqueOrThrow({ where: { id: pid } }),
    prisma.salesReport.findFirst({ where: { partnerId: pid, reportDate: today } }),
    prisma.salesReport.aggregate({ where: { partnerId: pid, status: { in: ["SUBMITTED", "APPROVED"] }, reportDate: { gte: startOfMonth(today) } }, _sum: { netSales: true, totalUnits: true } }),
    prisma.salesReport.findMany({ where: { partnerId: pid, status: { in: ["SUBMITTED", "APPROVED"] }, reportDate: { gte: addDays(today, -13) } }, orderBy: { reportDate: "asc" } }),
    prisma.invoice.findMany({ where: { partnerId: pid, status: { in: ["UNPAID", "PARTIALLY_PAID"] } } }),
    prisma.stockLevel.findMany({ where: { location: { partnerId: pid } }, include: { item: true } }),
    prisma.settlement.findFirst({ where: { partnerId: pid, status: "FINALIZED" }, orderBy: { periodEnd: "desc" } }),
    prisma.machine.findMany({ where: { currentPartnerId: pid } }),
  ]);
  const [contract, todayShift, openEarlier] = await Promise.all([
    contractOn(prisma, pid, today),
    prisma.shift.findUnique({ where: { partnerId_businessDate: { partnerId: pid, businessDate: today } } }),
    openShiftFor(prisma, pid, today),
  ]);
  const countMode = contract?.reportingMethod === "INVENTORY_COUNT";
  const opened = one((await searchParams).shift) === "opened";
  const owed = invoices.reduce((a, i) => a.plus(balanceOf(i)), new Decimal(0));
  const overdue = invoices.filter((i) => i.dueDate < today);
  const low = levels.filter((l) => D(l.item.partnerMinStock).gt(0) && D(l.quantity).lte(D(l.item.partnerMinStock)));
  const chart = last14.map((r) => ({ date: fmtDate(r.reportDate).slice(0, 5), sales: Number(D(r.netSales).toFixed(2)) }));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Hello, {partner.ownerName.split(" ")[0]}!</h1>
        <p className="text-sm text-choco-500">{fmtDate(today)}</p>
      </div>
      {opened && <Alert tone="mint">Shift opened. Have a great day of sales! 🍦</Alert>}
      {countMode ? (
        openEarlier ? (
          <Link href="/portal/sales/new" className="block rounded-2xl bg-berry-700 p-4 text-white shadow-card"><p className="text-lg font-bold">Close your shift for {fmtDate(openEarlier.businessDate)} →</p><p className="text-sm text-berry-100">It is still open. Submit its closing count first.</p></Link>
        ) : !todayShift ? (
          <Link href="/portal/shift" className="block rounded-2xl bg-mint-700 p-4 text-white shadow-card"><p className="text-lg font-bold">Open shift →</p><p className="text-sm text-mint-100">Confirm the cups, cones and powder carried over from yesterday.</p></Link>
        ) : todayShift.status === "OPEN" ? (
          <Link href="/portal/sales/new" className="block rounded-2xl bg-choco-700 p-4 text-cream-50 shadow-card"><p className="text-lg font-bold">Close shift (closing count) →</p><p className="text-sm text-choco-100">Shift {todayShift.number} open since {fmtDateTime(todayShift.openedAt).slice(11)}.</p></Link>
        ) : <Alert tone="mint">Today&apos;s shift is closed{todayReport ? ` — report ${todayReport.number} is ${todayReport.status.toLowerCase()}` : ""}. See you tomorrow!</Alert>
      ) : !todayReport || todayReport.status === "DRAFT" ? (
        <Link href={todayReport ? `/portal/sales/new?reportId=${todayReport.id}` : "/portal/sales/new"} className="block rounded-2xl bg-choco-700 p-4 text-cream-50 shadow-card">
          <p className="text-lg font-bold">Submit today&apos;s sales →</p><p className="text-sm text-choco-100">{todayReport ? "You have a saved draft." : "Takes about a minute."}</p>
        </Link>
      ) : <Alert tone="mint">Today&apos;s report {todayReport.number} is {todayReport.status.toLowerCase()}.</Alert>}
      {overdue.length > 0 && <Alert tone="berry">{overdue.length} invoice(s) are overdue. <Link className="link" href="/portal/invoices">Pay now</Link></Alert>}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Sales this month" value={formatPHP(mtd._sum.netSales)} hint={`${mtd._sum.totalUnits ?? 0} units`} tone="berry" href="/portal/sales" />
        <Stat label="Amount owed to Scoop Master" value={formatPHP(owed)} tone={overdue.length ? "berry" : "vanilla"} href="/portal/invoices" />
        <Stat label="Last statement – my share" value={statement ? formatPHP(statement.partnerShare) : "—"} hint={statement ? `${fmtDate(statement.periodStart)}–${fmtDate(statement.periodEnd)}` : "No statements yet"} tone="mint" href="/portal/statements" />
        <Stat label="Machine" value={machines.map((m) => m.code).join(", ") || "None"} hint={machines[0] ? `${machines[0].brand} ${machines[0].model}` : undefined} href="/portal/machine" />
      </div>
      <Card title="Sales – last 14 days"><BarChartBox data={chart} x="date" series={[{ key: "sales", label: "Net sales", color: PALETTE[1] }]} height={200} /></Card>
      <Card title="Low stock" actions={<Link className="link text-xs" href="/portal/supply-requests/new">Request supplies</Link>}>
        {low.length === 0 ? <p className="text-sm text-choco-500">Stock levels look fine.</p> : <ul className="space-y-1 text-sm">{low.map((l) => <li key={l.id} className="flex justify-between"><span>{l.item.name}</span><span className="font-semibold text-berry-700">{D(l.quantity).toDecimalPlaces(2).toString()} {UOM_LABEL[l.item.uom]}</span></li>)}</ul>}
      </Card>
      {invoices.length > 0 && <Card title="Open invoices"><ul className="space-y-1 text-sm">{invoices.slice(0, 5).map((i) => <li key={i.id} className="flex justify-between"><span>{i.number} · due {fmtDate(i.dueDate)}</span><Peso v={balanceOf(i)} /></li>)}</ul></Card>}
    </div>
  );
}
