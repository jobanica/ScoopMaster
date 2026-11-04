import Link from "next/link";
import { requirePartner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { Empty, LinkButton, PageHeader, StatusBadge } from "@/components/ui";

export const metadata = { title: "Supply requests" };
export default async function PortalSupply() {
  const user = await requirePartner();
  const orders = await prisma.supplyOrder.findMany({ where: { partnerId: user.partnerId }, include: { _count: { select: { lines: true } } }, orderBy: { requestedAt: "desc" }, take: 60 });
  return (
    <div>
      <PageHeader title="Supply requests" actions={<LinkButton href="/portal/supply-requests/new">+ New request</LinkButton>} />
      {orders.length === 0 ? <Empty>No requests yet.</Empty> : (
        <ul className="divide-y divide-choco-50 rounded-2xl border border-choco-100 bg-white">{orders.map((o) => (
          <li key={o.id}><Link href={`/portal/supply-requests/${o.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-cream-50"><span><span className="font-semibold">{o.number}</span><span className="block text-xs text-choco-500">{fmtDateTime(o.requestedAt)} · {o._count.lines} item(s)</span></span><StatusBadge status={o.status} /></Link></li>
        ))}</ul>
      )}
    </div>
  );
}
