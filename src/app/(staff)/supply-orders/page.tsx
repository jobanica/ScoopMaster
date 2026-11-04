import Link from "next/link";
import type { SupplyOrderStatus } from "@prisma/client";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { D, Decimal } from "@/lib/money";
import { fmtDateTime } from "@/lib/dates";
import { one, type SP } from "@/lib/params";
import { Card, Empty, FilterBar, FilterField, LinkButton, PageHeader, Peso, StatusBadge, humanize } from "@/components/ui";

export const metadata = { title: "Supply orders" };
const STATUSES: SupplyOrderStatus[] = ["REQUESTED", "APPROVED", "PREPARING", "DISPATCHED", "RECEIVED", "REJECTED", "CANCELLED"];

export default async function SupplyOrdersPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePage("supply:read");
  const status = one((await searchParams).status) as SupplyOrderStatus | undefined;
  const orders = await prisma.supplyOrder.findMany({
    where: status && STATUSES.includes(status) ? { status } : { status: { notIn: ["CANCELLED", "REJECTED"] } },
    include: { partner: true, lines: true, invoice: true }, orderBy: { requestedAt: "desc" }, take: 200,
  });
  const value = (o: (typeof orders)[number]) => o.lines.reduce((a, l) => a.plus(D(l.receivedQty ?? l.approvedQty ?? l.requestedQty).times(D(l.unitPrice))), new Decimal(0));
  return (
    <div>
      <PageHeader title="Supply orders" subtitle="Supplies sold to partners. Markup income is tracked separately from profit sharing." actions={can(user.role, "supply:review") && <LinkButton href="/supply-orders/new">+ New order for partner</LinkButton>} />
      <FilterBar>
        <FilterField label="Status"><select className="input" name="status" defaultValue={status ?? ""}><option value="">Open & received</option>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></FilterField>
      </FilterBar>
      <Card pad={false}>
        {orders.length === 0 ? <div className="p-5"><Empty /></div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Order</th><th>Partner</th><th>Requested</th><th>Status</th><th className="num">Lines</th><th className="num">Value (partner price)</th><th>Invoice</th></tr></thead>
            <tbody>{orders.map((o) => (
              <tr key={o.id}><td><Link className="link" href={`/supply-orders/${o.id}`}>{o.number}</Link></td><td>{o.partner.businessName}</td><td className="text-xs">{fmtDateTime(o.requestedAt)}</td><td><StatusBadge status={o.status} /></td><td className="num">{o.lines.length}</td><td className="num"><Peso v={value(o)} /></td>
                <td>{o.invoice ? <Link className="link" href={`/finance/invoices/${o.invoice.id}`}>{o.invoice.number}</Link> : "—"}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
