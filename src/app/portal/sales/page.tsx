import Link from "next/link";
import { requirePartner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { Badge, Empty, LinkButton, PageHeader, Peso, StatusBadge } from "@/components/ui";

export const metadata = { title: "My sales" };
export default async function PortalSales() {
  const user = await requirePartner();
  const reports = await prisma.salesReport.findMany({ where: { partnerId: user.partnerId }, orderBy: { reportDate: "desc" }, take: 90 });
  return (
    <div>
      <PageHeader title="My sales reports" actions={<LinkButton href="/portal/sales/new">+ Submit sales</LinkButton>} />
      {reports.length === 0 ? <Empty>No reports yet.</Empty> : (
        <ul className="divide-y divide-choco-50 rounded-2xl border border-choco-100 bg-white">{reports.map((r) => (
          <li key={r.id}><Link href={r.status === "DRAFT" || r.status === "REJECTED" ? `/portal/sales/new?reportId=${r.id}` : `/portal/sales/${r.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-cream-50">
            <span><span className="font-semibold">{fmtDate(r.reportDate)}</span><span className="block text-xs text-choco-500">{r.number} · {r.totalUnits} units</span></span>
            <span className="text-right"><Peso v={r.netSales} className="font-semibold" /><span className="mt-0.5 flex justify-end gap-1"><StatusBadge status={r.status} />{r.hasDiscrepancy && <Badge tone="berry">check</Badge>}</span></span>
          </Link></li>
        ))}</ul>
      )}
    </div>
  );
}
