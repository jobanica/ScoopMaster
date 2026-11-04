import Link from "next/link";
import { requirePartner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Peso } from "@/components/ui";

export const metadata = { title: "Statements" };
export default async function PortalStatements() {
  const user = await requirePartner();
  const rows = await prisma.settlement.findMany({ where: { partnerId: user.partnerId, status: "FINALIZED" }, orderBy: { periodEnd: "desc" } });
  return (
    <div>
      <PageHeader title="Profit-sharing statements" />
      {rows.length === 0 ? <Empty>No finalized statements yet.</Empty> : (
        <ul className="divide-y divide-choco-50 rounded-2xl border border-choco-100 bg-white">{rows.map((s) => (
          <li key={s.id}><Link href={`/portal/statements/${s.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-cream-50"><span><span className="font-semibold">{fmtDate(s.periodStart)} – {fmtDate(s.periodEnd)}</span><span className="block text-xs text-choco-500">{s.number} · net sales <Peso v={s.netSales} /></span></span><span className="text-right text-sm">My share<br /><Peso v={s.partnerShare} className="font-bold" /></span></Link></li>
        ))}</ul>
      )}
    </div>
  );
}
