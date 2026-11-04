import Link from "next/link";
import type { MachineStatus } from "@prisma/client";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, todayDate } from "@/lib/dates";
import { one, type SP } from "@/lib/params";
import { machineProfitability } from "@/server/services/machines";
import { Badge, Card, Empty, FilterBar, FilterField, LinkButton, PageHeader, Peso, StatusBadge, humanize } from "@/components/ui";

export const metadata = { title: "Machines" };
const STATUSES: MachineStatus[] = ["AVAILABLE", "RESERVED", "DEPLOYED", "UNDER_MAINTENANCE", "RETURNED", "SOLD"];

export default async function MachinesPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePage("machines:read");
  const sp = await searchParams;
  const status = one(sp.status) as MachineStatus | undefined;
  const q = one(sp.q);
  const rows = await machineProfitability();
  const fin = can(user.role, "dashboard:financials");
  const partners = await prisma.partner.findMany({ where: { id: { in: rows.map((r) => r.machine.currentPartnerId).filter(Boolean) as string[] } }, select: { id: true, businessName: true } });
  const filtered = rows.filter((r) => (!status || r.machine.status === status || (status === "AVAILABLE" && r.machine.status === "RETURNED")) && (!q || `${r.machine.code} ${r.machine.serialNumber} ${r.machine.brand} ${r.machine.model}`.toLowerCase().includes(q.toLowerCase())));
  const today = todayDate();
  return (
    <div>
      <PageHeader title="Machines" subtitle={`${rows.length} machines · ${rows.filter((r) => r.machine.status === "DEPLOYED").length} deployed`} actions={can(user.role, "machines:write") && <LinkButton href="/machines/new">+ Add machine</LinkButton>} />
      <FilterBar>
        <FilterField label="Search"><input className="input" name="q" defaultValue={q} placeholder="ID, serial, brand" /></FilterField>
        <FilterField label="Status"><select className="input" name="status" defaultValue={status ?? ""}><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></FilterField>
      </FilterBar>
      <Card pad={false}>
        {filtered.length === 0 ? <div className="p-5"><Empty /></div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>ID</th><th>Brand / model</th><th>Serial</th><th>Status</th><th>Partner</th><th>Condition</th><th className="num">Sales</th>{fin && <><th className="num">My income</th><th className="num">Maintenance</th><th className="num">ROI</th></>}<th className="num">Utilization</th></tr></thead>
            <tbody>{filtered.map((r) => (
              <tr key={r.machine.id}>
                <td><Link className="link font-mono text-xs" href={`/machines/${r.machine.id}`}>{r.machine.code}</Link></td>
                <td>{r.machine.brand} {r.machine.model}<div className="text-xs text-choco-500">{r.machine.nozzles} nozzle(s)</div></td>
                <td className="text-xs">{r.machine.serialNumber}</td>
                <td><StatusBadge status={r.machine.status} />{r.machine.nextMaintenanceDate && r.machine.nextMaintenanceDate <= today && <div><Badge tone="berry">maintenance due</Badge></div>}</td>
                <td>{partners.find((p) => p.id === r.machine.currentPartnerId)?.businessName ?? "—"}{r.machine.deployedAt && <div className="text-xs text-choco-500">since {fmtDate(r.machine.deployedAt)}</div>}</td>
                <td>{humanize(r.machine.condition)}</td>
                <td className="num"><Peso v={r.totalSales} /></td>
                {fin && <><td className="num"><Peso v={r.partnershipIncome} /></td><td className="num"><Peso v={r.maintenanceCost} /></td><td className="num">{r.roiPct.toFixed(1)}%</td></>}
                <td className="num">{r.utilizationPct}%</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
