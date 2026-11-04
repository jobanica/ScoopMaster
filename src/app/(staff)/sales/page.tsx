import Link from "next/link";
import type { Prisma, SalesReportStatus } from "@prisma/client";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { formatPHP } from "@/lib/money";
import { addDays, fmtDate, todayDate } from "@/lib/dates";
import { one, pageParam, rangeParams, type SP } from "@/lib/params";
import { partnersMissingReports } from "@/server/services/sales";
import { Badge, Card, Empty, FilterBar, FilterField, LinkButton, PageHeader, Pagination, Peso, Stat, StatusBadge } from "@/components/ui";
import { ConfirmAction } from "@/components/forms";
import { approveCleanAction } from "./actions";

export const metadata = { title: "Sales reports" };
const STATUSES: SalesReportStatus[] = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"];

export default async function SalesPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePage("sales:read");
  const sp = await searchParams;
  const r = rangeParams(sp, { from: addDays(todayDate(), -30), to: todayDate() });
  const partnerId = one(sp.partnerId);
  const status = one(sp.status) as SalesReportStatus | undefined;
  const disc = one(sp.disc);
  const page = pageParam(sp.page);
  const where: Prisma.SalesReportWhereInput = {
    reportDate: { gte: r.from, lte: r.to },
    ...(partnerId ? { partnerId } : {}),
    ...(status && STATUSES.includes(status) ? { status } : {}),
    ...(disc ? { hasDiscrepancy: true } : {}),
  };
  const yesterday = addDays(todayDate(), -1);
  const [total, reports, agg, partners, pendingClean, missing, editReqs] = await Promise.all([
    prisma.salesReport.count({ where }),
    prisma.salesReport.findMany({ where, orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }], skip: (page - 1) * 30, take: 30, include: { partner: { select: { businessName: true } }, machine: { select: { code: true } } } }),
    prisma.salesReport.aggregate({ where: { ...where, status: { in: ["SUBMITTED", "APPROVED"] } }, _sum: { netSales: true, cashVariance: true, totalUnits: true } }),
    prisma.partner.findMany({ where: { status: { in: ["ACTIVE", "ON_HOLD"] } }, orderBy: { businessName: "asc" }, select: { id: true, businessName: true } }),
    prisma.salesReport.count({ where: { status: "SUBMITTED", hasDiscrepancy: false } }),
    partnersMissingReports(yesterday),
    prisma.salesEditRequest.count({ where: { status: "PENDING" } }),
  ]);
  return (
    <div>
      <PageHeader title="Sales reports" subtitle={`${r.fromText} – ${r.toText}`} actions={<>
        {can(user.role, "sales:review") && pendingClean > 0 && <ConfirmAction action={approveCleanAction} label={`Approve ${pendingClean} clean report(s)`} title="Approve all clean reports?" description="Approves every submitted report with no discrepancy and posts theoretical consumption to partner inventory." variant="success" />}
        <LinkButton href="/sales/shifts" variant="secondary">Partner shifts</LinkButton>
        {can(user.role, "sales:write") && <LinkButton href="/sales/new">+ Manual entry</LinkButton>}
      </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Net sales (submitted + approved)" value={formatPHP(agg._sum.netSales)} tone="berry" />
        <Stat label="Units sold" value={agg._sum.totalUnits ?? 0} />
        <Stat label="Net cash variance" value={formatPHP(agg._sum.cashVariance)} tone={agg._sum.cashVariance && Number(agg._sum.cashVariance) < 0 ? "berry" : "mint"} />
        <Stat label="Pending edit requests" value={editReqs} tone={editReqs ? "vanilla" : "mint"} />
      </div>
      {missing.length > 0 && (
        <Card title={`No report yet for ${fmtDate(yesterday)} (${missing.length})`} className="mb-4">
          <div className="flex flex-wrap gap-2">{missing.map((p) => <Link key={p.id} href={`/partners/${p.id}?tab=sales`}><Badge tone="vanilla">{p.businessName}</Badge></Link>)}</div>
        </Card>
      )}
      <FilterBar>
        <FilterField label="From"><input className="input" name="from" defaultValue={r.fromText} /></FilterField>
        <FilterField label="To"><input className="input" name="to" defaultValue={r.toText} /></FilterField>
        <FilterField label="Partner"><select className="input" name="partnerId" defaultValue={partnerId ?? ""}><option value="">All</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.businessName}</option>)}</select></FilterField>
        <FilterField label="Status"><select className="input" name="status" defaultValue={status ?? ""}><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select></FilterField>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="disc" value="1" defaultChecked={!!disc} /> Discrepancies only</label>
      </FilterBar>
      <Card pad={false}>
        {reports.length === 0 ? <div className="p-5"><Empty /></div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Date</th><th>Report</th><th>Partner</th><th>Machine</th><th>Status</th><th className="num">Units</th><th className="num">Net sales</th><th className="num">Sales var.</th><th className="num">Cash var.</th></tr></thead>
            <tbody>{reports.map((s) => (
              <tr key={s.id}>
                <td>{fmtDate(s.reportDate)}</td>
                <td><Link className="link" href={`/sales/${s.id}`}>{s.number}</Link>{s.revision > 0 && <span className="ml-1 text-xs text-choco-500">rev {s.revision}</span>}</td>
                <td>{s.partner.businessName}</td>
                <td className="text-xs">{s.machine?.code ?? "—"}</td>
                <td><StatusBadge status={s.status} /> {s.hasDiscrepancy && <Badge tone="berry">discrepancy</Badge>} {s.settlementId && <Badge tone="sky">settled</Badge>}</td>
                <td className="num">{s.totalUnits}</td>
                <td className="num"><Peso v={s.netSales} /></td>
                <td className="num"><Peso v={s.salesVariance} /></td>
                <td className="num"><Peso v={s.cashVariance} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <Pagination page={page} pageSize={30} total={total} params={{ from: r.fromText, to: r.toText, partnerId, status, disc }} />
    </div>
  );
}
