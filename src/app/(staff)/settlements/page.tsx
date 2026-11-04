import Link from "next/link";
import type { SettlementStatus } from "@prisma/client";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { one, type SP } from "@/lib/params";
import { Card, Empty, FilterBar, FilterField, LinkButton, PageHeader, Peso, StatusBadge, humanize } from "@/components/ui";
import { ConfirmAction } from "@/components/forms";
import { createDueAction, finalizePendingAction } from "./actions";

export const metadata = { title: "Settlements" };
export default async function SettlementsPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePage("settlements:read");
  const sp = await searchParams;
  const status = one(sp.status) as SettlementStatus | undefined;
  const partnerId = one(sp.partnerId);
  const pendingCount = await prisma.settlement.count({ where: { status: "PENDING_APPROVAL", ...(user.role === "SUPER_ADMIN" ? {} : { NOT: { preparedById: user.id } }) } });
  const [rows, partners] = await Promise.all([
    prisma.settlement.findMany({ where: { ...(status ? { status } : {}), ...(partnerId ? { partnerId } : {}) }, include: { partner: true }, orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }], take: 200 }),
    prisma.partner.findMany({ orderBy: { businessName: "asc" }, select: { id: true, businessName: true } }),
  ]);
  return (
    <div>
      <PageHeader title="Partnership settlements" subtitle="Profit sharing per individual contract. Supply markup is reported separately and never added to the split." actions={<>
        {can(user.role, "settlements:prepare") && <ConfirmAction action={createDueAction} label="Create all due settlements" variant="secondary" title="Create and submit all due settlements?" description="For every active partner, settlements are created per their schedule (e.g. daily) up to yesterday from approved reports, then submitted for approval. Days without activity are merged into the next period. Partners with unreviewed reports are left as drafts." />}
        {can(user.role, "settlements:approve") && pendingCount > 0 && <ConfirmAction action={finalizePendingAction} label={`Finalize ${pendingCount} pending`} variant="success" title={`Finalize ${pendingCount} settlement(s)?`} description="Creates the receivable (or payable) for each and publishes the statements to partners. Settlements you prepared yourself are skipped." />}
        {can(user.role, "settlements:prepare") && <LinkButton href="/settlements/new">+ New settlement</LinkButton>}
      </>} />
      <FilterBar>
        <FilterField label="Status"><select className="input" name="status" defaultValue={status ?? ""}><option value="">All</option>{["DRAFT", "PENDING_APPROVAL", "FINALIZED", "VOIDED"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></FilterField>
        <FilterField label="Partner"><select className="input" name="partnerId" defaultValue={partnerId ?? ""}><option value="">All</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.businessName}</option>)}</select></FilterField>
      </FilterBar>
      <Card pad={false}>
        {rows.length === 0 ? <div className="p-5"><Empty>No settlements yet.</Empty></div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Settlement</th><th>Partner</th><th>Period</th><th>Status</th><th className="num">Net sales</th><th className="num">Supplies</th><th className="num">Expenses</th><th className="num">Distributable</th><th className="num">My share</th><th className="num">Partner share</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id} className={s.status === "VOIDED" ? "opacity-50" : ""}><td><Link className="link" href={`/settlements/${s.id}`}>{s.number}</Link></td><td>{s.partner.businessName}</td><td className="whitespace-nowrap">{fmtDate(s.periodStart)} – {fmtDate(s.periodEnd)}</td><td><StatusBadge status={s.status} /></td>
                <td className="num"><Peso v={s.netSales} /></td><td className="num"><Peso v={s.suppliesConsumed} /></td><td className="num"><Peso v={s.operatingExpenses} /></td><td className="num"><Peso v={s.distributableProfit} /></td><td className="num font-semibold"><Peso v={s.ownerShare} /></td><td className="num"><Peso v={s.partnerShare} /></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
