import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { D, formatQty, Decimal } from "@/lib/money";
import { markup } from "@/lib/calc/inventory";
import { UOM_LABEL } from "@/lib/units";
import { one, type SP } from "@/lib/params";
import { Badge, Card, Empty, FilterBar, FilterField, LinkButton, PageHeader, Peso, humanize } from "@/components/ui";
import { InventoryTabs } from "../subnav";

export const metadata = { title: "Inventory items" };
export default async function ItemsPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePage("inventory:read");
  const q = one((await searchParams).q);
  const items = await prisma.inventoryItem.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {},
    include: { supplier: true, stockLevels: { include: { location: true } } }, orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return (
    <div>
      <PageHeader title="Inventory" actions={can(user.role, "inventory:items") && <LinkButton href="/inventory/items/new">+ New item</LinkButton>} />
      <InventoryTabs active="items" />
      <FilterBar><FilterField label="Search"><input className="input" name="q" defaultValue={q} placeholder="SKU or name" /></FilterField></FilterBar>
      <Card pad={false}>
        {items.length === 0 ? <div className="p-5"><Empty>No items yet.</Empty></div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>SKU</th><th>Item</th><th>Category</th><th>UoM</th><th className="num">Avg cost</th><th className="num">Partner price</th><th className="num">Markup</th><th className="num">Warehouse</th><th className="num">Min</th><th>Supplier</th></tr></thead>
            <tbody>{items.map((i) => {
              const wh = i.stockLevels.filter((s) => s.location.type === "WAREHOUSE").reduce((a, s) => a.plus(D(s.quantity)), new Decimal(0));
              const mk = markup(i.avgCost, i.partnerPrice);
              return (
                <tr key={i.id}>
                  <td className="font-mono text-xs">{i.sku}</td>
                  <td><Link className="link" href={`/inventory/items/${i.id}`}>{i.name}</Link> {!i.isActive && <Badge>inactive</Badge>} {i.isPerishable && <Badge tone="vanilla">perishable</Badge>}</td>
                  <td>{humanize(i.category)}</td><td>{UOM_LABEL[i.uom]}</td>
                  <td className="num"><Peso v={i.avgCost} /></td><td className="num"><Peso v={i.partnerPrice} /></td>
                  <td className="num"><Peso v={mk.amount} /> <span className="text-xs text-choco-500">{mk.pct.toFixed(0)}%</span></td>
                  <td className={`num ${D(i.minStock).gt(0) && wh.lte(D(i.minStock)) ? "font-semibold text-berry-700" : ""}`}>{formatQty(wh, 3)}</td>
                  <td className="num">{formatQty(i.minStock)}</td><td className="text-xs">{i.supplier?.name ?? "—"}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
