import type { Prisma } from "@prisma/client";
import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addDays, fmtDateTime, manilaDayStart, todayDate } from "@/lib/dates";
import { one, pageParam, rangeParams, type SP } from "@/lib/params";
import { Card, Empty, FilterBar, FilterField, PageHeader, Pagination } from "@/components/ui";

export const metadata = { title: "Audit log" };
export default async function AuditPage({ searchParams }: { searchParams: SP }) {
  await requirePage("audit:read");
  const sp = await searchParams;
  const r = rangeParams(sp, { from: addDays(todayDate(), -7), to: todayDate() });
  const entityType = one(sp.entityType);
  const action = one(sp.action);
  const entityId = one(sp.entityId);
  const page = pageParam(sp.page);
  const where: Prisma.AuditLogWhereInput = { createdAt: { gte: manilaDayStart(r.from), lt: manilaDayStart(addDays(r.to, 1)) }, ...(entityType ? { entityType } : {}), ...(action ? { action: { contains: action, mode: "insensitive" } } : {}), ...(entityId ? { entityId } : {}) };
  const [total, rows] = await Promise.all([prisma.auditLog.count({ where }), prisma.auditLog.findMany({ where, include: { user: { select: { name: true, role: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 })]);
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every create, change, approval, reversal and login is recorded here. Entries cannot be edited or deleted from the application." />
      <FilterBar>
        <FilterField label="From"><input className="input" name="from" defaultValue={r.fromText} /></FilterField>
        <FilterField label="To"><input className="input" name="to" defaultValue={r.toText} /></FilterField>
        <FilterField label="Entity"><input className="input" name="entityType" defaultValue={entityType} placeholder="e.g. Settlement" /></FilterField>
        <FilterField label="Action"><input className="input" name="action" defaultValue={action} placeholder="e.g. VOID" /></FilterField>
        <FilterField label="Record ID"><input className="input" name="entityId" defaultValue={entityId} /></FilterField>
      </FilterBar>
      <Card pad={false}>
        {rows.length === 0 ? <div className="p-5"><Empty /></div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Summary</th><th>Details</th></tr></thead>
            <tbody>{rows.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap text-xs">{fmtDateTime(a.createdAt)}</td>
                <td className="text-xs">{a.user?.name ?? "system"}</td>
                <td className="font-mono text-xs">{a.action}</td>
                <td className="text-xs">{a.entityType}<div className="font-mono text-[10px] text-choco-400">{a.entityId}</div></td>
                <td className="max-w-xs text-xs">{a.summary}</td>
                <td>{(a.before || a.after) && <details><summary className="cursor-pointer text-xs text-choco-600">view</summary><pre className="mt-1 max-h-64 max-w-md overflow-auto rounded bg-cream-100 p-2 text-[10px]">{JSON.stringify({ before: a.before, after: a.after }, null, 1)}</pre></details>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <Pagination page={page} pageSize={50} total={total} params={{ from: r.fromText, to: r.toText, entityType, action, entityId }} />
    </div>
  );
}
