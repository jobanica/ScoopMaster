import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { D, formatPHP, formatQty, Decimal } from "@/lib/money";
import { addDays, fmtDate, todayDate } from "@/lib/dates";
import { UOM_LABEL } from "@/lib/units";
import { one, type SP } from "@/lib/params";
import { inventoryValuation } from "@/server/services/inventory";
import { Badge, Card, Empty, FilterBar, FilterField, PageHeader, Peso, Stat, humanize } from "@/components/ui";
import { InventoryTabs } from "./subnav";

export const metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: { searchParams: SP }) {
  await requirePage("inventory:read");
  const sp = await searchParams;
  const locationId = one(sp.locationId);
  const category = one(sp.category);
  const low = one(sp.low);
  const [locations, rows, batches] = await Promise.all([
    prisma.location.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    inventoryValuation(locationId),
    prisma.stockBatch.findMany({ where: { quantity: { gt: 0 }, expiryDate: { not: null, lte: addDays(todayDate(), 60) } }, include: { item: true, location: true }, orderBy: { expiryDate: "asc" }, take: 20 }),
  ]);
  const filtered = rows.filter((r) => (!category || r.category === category) && (!low || (r.minStock.gt(0) && r.quantity.lte(r.minStock))));
  const total = (t?: string) => rows.filter((r) => !t || r.locationType === t).reduce((a, r) => a.plus(r.costValue), new Decimal(0));
  const today = todayDate();
  return (
    <div>
      <PageHeader title="Inventory" subtitle="Every quantity shown here is the sum of recorded movements — stock never changes without an audit record." />
      <InventoryTabs active="stock" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total inventory value (cost)" value={formatPHP(total())} />
        <Stat label="Warehouse" value={formatPHP(total("WAREHOUSE"))} tone="sky" />
        <Stat label="At partner locations" value={formatPHP(total("PARTNER"))} tone="mint" />
        <Stat label="In transit" value={formatPHP(total("IN_TRANSIT"))} tone="vanilla" />
      </div>
      {batches.length > 0 && (
        <Card title="Expiring within 60 days" className="mb-4" pad={false}>
          <table className="tbl"><thead><tr><th>Item</th><th>Batch</th><th>Location</th><th>Expiry</th><th className="num">Qty</th></tr></thead>
            <tbody>{batches.map((b) => <tr key={b.id}><td>{b.item.name}</td><td>{b.batchNo}</td><td>{b.location.name}</td><td>{fmtDate(b.expiryDate)} {b.expiryDate! < today ? <Badge tone="berry">expired</Badge> : <Badge tone="vanilla">soon</Badge>}</td><td className="num">{formatQty(b.quantity)} {UOM_LABEL[b.item.uom]}</td></tr>)}</tbody></table>
        </Card>
      )}
      <FilterBar>
        <FilterField label="Location"><select className="input" name="locationId" defaultValue={locationId ?? ""}><option value="">All locations</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></FilterField>
        <FilterField label="Category"><select className="input" name="category" defaultValue={category ?? ""}><option value="">All</option>{["ICE_CREAM_POWDER", "CONES", "CUPS", "SPOONS", "TOPPINGS", "SYRUPS", "PACKAGING", "CLEANING", "SPARE_PARTS", "OTHER"].map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></FilterField>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="low" value="1" defaultChecked={!!low} /> Low stock only</label>
      </FilterBar>
      <Card pad={false}>
        {filtered.length === 0 ? <div className="p-5"><Empty>No stock. Receive purchases under <Link className="link" href="/inventory/operations">Stock operations</Link>.</Empty></div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>SKU</th><th>Item</th><th>Location</th><th className="num">On hand</th><th className="num">Avg cost</th><th className="num">Value (cost)</th><th className="num">Value (partner price)</th><th></th></tr></thead>
            <tbody>{filtered.map((r) => (
              <tr key={`${r.itemId}-${r.locationId}`}>
                <td className="font-mono text-xs">{r.sku}</td>
                <td><Link className="link" href={`/inventory/items/${r.itemId}`}>{r.name}</Link><div className="text-xs text-choco-500">{humanize(r.category)}</div></td>
                <td>{r.location}</td>
                <td className="num">{formatQty(r.quantity, 3)} {UOM_LABEL[r.uom]}</td>
                <td className="num"><Peso v={r.avgCost} /></td>
                <td className="num"><Peso v={r.costValue} /></td>
                <td className="num"><Peso v={r.priceValue} /></td>
                <td>{r.minStock.gt(0) && r.quantity.lte(r.minStock) && <Badge tone="berry">low</Badge>}{D(r.quantity).isNegative() && <Badge tone="berry">count needed</Badge>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
