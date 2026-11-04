import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { D, formatQty } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { markup } from "@/lib/calc/inventory";
import { UOM_LABEL } from "@/lib/units";
import { Card, DL, Empty, PageHeader, Peso, StatusBadge, humanize } from "@/components/ui";
import { ItemForm } from "../../item-form";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("inventory:read");
  const item = await prisma.inventoryItem.findUnique({
    where: { id: (await params).id },
    include: { supplier: true, stockLevels: { include: { location: true } }, batches: { where: { quantity: { gt: 0 } }, include: { location: true }, orderBy: { expiryDate: "asc" } } },
  });
  if (!item) notFound();
  const movements = await prisma.stockMovement.findMany({ where: { itemId: item.id }, include: { location: true }, orderBy: { createdAt: "desc" }, take: 50 });
  const suppliers = await prisma.contact.findMany({ where: { type: "SUPPLIER", isActive: true }, orderBy: { name: "asc" } });
  const mk = markup(item.avgCost, item.partnerPrice);
  const u = UOM_LABEL[item.uom];
  return (
    <div>
      <PageHeader title={item.name} subtitle={`${item.sku} · ${humanize(item.category)} · per ${u}`} back={{ href: "/inventory/items", label: "Items" }} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Costing">
          <DL cols={1} items={[["Weighted average cost", <Peso key="a" v={item.avgCost} />], ["Latest purchase cost", <Peso key="p" v={item.purchaseCost} />], ["Selling price to partner", <Peso key="s" v={item.partnerPrice} />], ["Markup", <span key="m"><Peso v={mk.amount} /> ({mk.pct.toFixed(1)}%)</span>], ["Supplier", item.supplier?.name]]} />
        </Card>
        <Card title="Stock by location" pad={false}>
          {item.stockLevels.length === 0 ? <div className="p-5"><Empty>No stock.</Empty></div> : (
            <table className="tbl"><tbody>{item.stockLevels.map((s) => <tr key={s.id}><td>{s.location.name}</td><td className="num">{formatQty(s.quantity, 3)} {u}</td></tr>)}</tbody></table>
          )}
        </Card>
        <Card title="Batches" pad={false}>
          {item.batches.length === 0 ? <div className="p-5"><Empty>No batch-tracked stock.</Empty></div> : (
            <table className="tbl"><thead><tr><th>Batch</th><th>Location</th><th>Expiry</th><th className="num">Qty</th></tr></thead><tbody>{item.batches.map((b) => <tr key={b.id}><td>{b.batchNo}</td><td className="text-xs">{b.location.name}</td><td>{fmtDate(b.expiryDate)}</td><td className="num">{formatQty(b.quantity)}</td></tr>)}</tbody></table>
          )}
        </Card>
      </div>
      {can(user.role, "inventory:items") && <Card title="Edit item" className="mt-4"><ItemForm item={item} suppliers={suppliers} /></Card>}
      <Card title="Recent movements" className="mt-4" pad={false}>
        {movements.length === 0 ? <div className="p-5"><Empty /></div> : (
          <div className="table-wrap"><table className="tbl"><thead><tr><th>When</th><th>No.</th><th>Type</th><th>Location</th><th className="num">Qty</th><th className="num">Balance</th><th className="num">Unit cost</th><th>Reason / source</th></tr></thead>
            <tbody>{movements.map((m) => <tr key={m.id}><td className="text-xs">{fmtDateTime(m.occurredAt)}</td><td className="font-mono text-xs">{m.number}</td><td><StatusBadge status={m.type} /></td><td>{m.location.name}</td><td className={`num ${D(m.quantity).isNegative() ? "text-berry-700" : "text-mint-700"}`}>{formatQty(m.quantity, 4)}</td><td className="num">{formatQty(m.balanceAfter, 3)}</td><td className="num"><Peso v={m.unitCost} /></td><td className="text-xs">{m.reason}</td></tr>)}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}
