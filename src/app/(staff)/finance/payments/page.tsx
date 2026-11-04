import Link from "next/link";
import type { PaymentRecordStatus, Prisma } from "@prisma/client";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { one, rangeParams, type SP } from "@/lib/params";
import { Card, Empty, FilterBar, FilterField, LinkButton, PageHeader, Peso, StatusBadge, humanize } from "@/components/ui";
import { FinanceTabs } from "../tabs";

export const metadata = { title: "Payments" };
export default async function PaymentsPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePage("finance:read");
  const sp = await searchParams;
  const status = one(sp.status) as PaymentRecordStatus | undefined;
  const direction = one(sp.direction);
  const r = rangeParams(sp, status === "PENDING_VERIFICATION" ? { from: new Date("2000-01-01"), to: new Date("2100-01-01") } : undefined);
  const where: Prisma.PaymentWhereInput = { paymentDate: { gte: r.from, lte: r.to }, ...(status ? { status } : {}), ...(direction === "IN" || direction === "OUT" ? { direction } : {}) };
  const rows = await prisma.payment.findMany({ where, orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }], take: 300 });
  return (
    <div>
      <PageHeader title="Finance" actions={can(user.role, "payments:write") && <LinkButton href="/finance/payments/new">+ Record payment</LinkButton>} />
      <FinanceTabs active="payments" />
      <FilterBar>
        <FilterField label="From"><input className="input" name="from" defaultValue={r.fromText} /></FilterField>
        <FilterField label="To"><input className="input" name="to" defaultValue={r.toText} /></FilterField>
        <FilterField label="Direction"><select className="input" name="direction" defaultValue={direction ?? ""}><option value="">All</option><option value="IN">Received</option><option value="OUT">Paid out</option></select></FilterField>
        <FilterField label="Status"><select className="input" name="status" defaultValue={status ?? ""}><option value="">All</option>{["PENDING_VERIFICATION", "CONFIRMED", "REJECTED", "VOIDED"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></FilterField>
      </FilterBar>
      <Card pad={false}>
        {rows.length === 0 ? <div className="p-5"><Empty /></div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>No.</th><th>Date</th><th>Party</th><th>Direction</th><th>Method</th><th>Reference</th><th>Status</th><th className="num">Amount</th></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id}><td><Link className="link" href={`/finance/payments/${p.id}`}>{p.number}</Link></td><td>{fmtDate(p.paymentDate)}</td><td>{p.partyName}</td><td>{p.direction === "IN" ? "Received" : "Paid out"}</td><td>{humanize(p.method)}</td><td className="text-xs">{p.reference ?? "—"}</td><td><StatusBadge status={p.status} /></td><td className={`num font-semibold ${p.direction === "IN" ? "text-mint-700" : "text-berry-700"}`}><Peso v={p.amount} /></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
