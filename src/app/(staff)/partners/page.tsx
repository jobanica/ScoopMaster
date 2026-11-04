import Link from "next/link";
import type { PartnerStatus, Prisma } from "@prisma/client";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { D, Decimal } from "@/lib/money";
import { startOfMonth, todayDate } from "@/lib/dates";
import { one, pageParam, type SP } from "@/lib/params";
import { Card, Empty, FilterBar, FilterField, LinkButton, PageHeader, Pagination, Peso, StatusBadge } from "@/components/ui";

export const metadata = { title: "Partners" };
const STATUSES: PartnerStatus[] = ["PROSPECT", "PENDING_APPROVAL", "ACTIVE", "ON_HOLD", "TERMINATED"];

export default async function PartnersPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePage("partners:read");
  const sp = await searchParams;
  const q = one(sp.q);
  const status = one(sp.status) as PartnerStatus | undefined;
  const area = one(sp.area);
  const page = pageParam(sp.page);
  const where: Prisma.PartnerWhereInput = {
    ...(q ? { OR: [{ businessName: { contains: q, mode: "insensitive" } }, { ownerName: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } : {}),
    ...(status && STATUSES.includes(status) ? { status } : {}),
    ...(area ? { area: { contains: area, mode: "insensitive" } } : {}),
  };
  const [total, partners] = await Promise.all([
    prisma.partner.count({ where }),
    prisma.partner.findMany({ where, orderBy: { code: "asc" }, skip: (page - 1) * 25, take: 25, include: { machines: { select: { code: true } } } }),
  ]);
  const ids = partners.map((p) => p.id);
  const [mtd, ar] = await Promise.all([
    prisma.salesReport.groupBy({ by: ["partnerId"], where: { partnerId: { in: ids }, status: { in: ["SUBMITTED", "APPROVED"] }, reportDate: { gte: startOfMonth(todayDate()) } }, _sum: { netSales: true } }),
    prisma.invoice.findMany({ where: { partnerId: { in: ids }, status: { in: ["UNPAID", "PARTIALLY_PAID"] } }, select: { partnerId: true, amount: true, amountPaid: true } }),
  ]);
  const arBy = new Map<string, Decimal>();
  for (const i of ar) arBy.set(i.partnerId!, (arBy.get(i.partnerId!) ?? new Decimal(0)).plus(D(i.amount).minus(D(i.amountPaid))));

  return (
    <div>
      <PageHeader title="Partners" subtitle={`${total} partner location${total === 1 ? "" : "s"}`} actions={can(user.role, "partners:write") && <LinkButton href="/partners/new">+ New partner</LinkButton>} />
      <FilterBar>
        <FilterField label="Search"><input className="input" name="q" defaultValue={q} placeholder="Name, owner or ID" /></FilterField>
        <FilterField label="Status">
          <select className="input" name="status" defaultValue={status ?? ""}><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
        </FilterField>
        <FilterField label="Area"><input className="input" name="area" defaultValue={area} /></FilterField>
      </FilterBar>
      <Card pad={false}>
        {partners.length === 0 ? <div className="p-5"><Empty>No partners match. {can(user.role, "partners:write") && <Link className="link" href="/partners/new">Add your first partner</Link>}</Empty></div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>ID</th><th>Business</th><th>Owner</th><th>Area</th><th>Status</th><th>Machines</th><th className="num">Sales MTD</th><th className="num">Outstanding</th></tr></thead>
            <tbody>{partners.map((p) => (
              <tr key={p.id}>
                <td className="font-mono text-xs">{p.code}</td>
                <td><Link className="link" href={`/partners/${p.id}`}>{p.businessName}</Link></td>
                <td>{p.ownerName}</td>
                <td>{p.area ?? "—"}</td>
                <td><StatusBadge status={p.status} /></td>
                <td className="text-xs">{p.machines.map((m) => m.code).join(", ") || "—"}</td>
                <td className="num"><Peso v={mtd.find((m) => m.partnerId === p.id)?._sum.netSales ?? 0} /></td>
                <td className="num"><Peso v={arBy.get(p.id) ?? 0} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <Pagination page={page} pageSize={25} total={total} params={{ q, status, area }} />
    </div>
  );
}
