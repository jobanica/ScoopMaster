import type { MovementType, Prisma } from "@prisma/client";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { D, formatQty } from "@/lib/money";
import { addDays, fmtDateTime, manilaDayStart, todayDate } from "@/lib/dates";
import { UOM_LABEL } from "@/lib/units";
import { one, pageParam, rangeParams, type SP } from "@/lib/params";
import { Card, Empty, FilterBar, FilterField, PageHeader, Pagination, Peso, StatusBadge, humanize } from "@/components/ui";
import { ConfirmAction } from "@/components/forms";
import { InventoryTabs } from "../subnav";
import { reverseMovementAction } from "../actions";

export const metadata = { title: "Movement history" };
const TYPES: MovementType[] = ["RECEIPT", "ISSUE", "TRANSFER_OUT", "TRANSFER_IN", "ADJUSTMENT", "RETURN_IN", "RETURN_OUT", "DAMAGED", "EXPIRED", "CONSUMPTION", "WASTAGE", "COUNT_VARIANCE", "REVERSAL"];

export default async function MovementsPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePage("inventory:read");
  const sp = await searchParams;
  const r = rangeParams(sp, { from: addDays(todayDate(), -30), to: todayDate() });
  const locationId = one(sp.locationId);
  const itemId = one(sp.itemId);
  const type = one(sp.type) as MovementType | undefined;
  const page = pageParam(sp.page);
  const where: Prisma.StockMovementWhereInput = {
    occurredAt: { gte: manilaDayStart(r.from), lt: manilaDayStart(addDays(r.to, 1)) },
    ...(locationId ? { locationId } : {}), ...(itemId ? { itemId } : {}), ...(type && TYPES.includes(type) ? { type } : {}),
  };
  const [total, rows, locations, items] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({ where, include: { item: true, location: true, reversedBy: { select: { id: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 }),
    prisma.location.findMany({ orderBy: { name: "asc" } }),
    prisma.inventoryItem.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((m) => m.createdById).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  return (
    <div>
      <PageHeader title="Inventory" />
      <InventoryTabs active="movements" />
      <FilterBar>
        <FilterField label="From"><input className="input" name="from" defaultValue={r.fromText} /></FilterField>
        <FilterField label="To"><input className="input" name="to" defaultValue={r.toText} /></FilterField>
        <FilterField label="Location"><select className="input" name="locationId" defaultValue={locationId ?? ""}><option value="">All</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></FilterField>
        <FilterField label="Item"><select className="input" name="itemId" defaultValue={itemId ?? ""}><option value="">All</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></FilterField>
        <FilterField label="Type"><select className="input" name="type" defaultValue={type ?? ""}><option value="">All</option>{TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></FilterField>
      </FilterBar>
      <Card pad={false}>
        {rows.length === 0 ? <div className="p-5"><Empty /></div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>When</th><th>No.</th><th>Type</th><th>Item</th><th>Location</th><th className="num">Qty</th><th className="num">Balance after</th><th className="num">Unit cost</th><th>Reason / source</th><th>By</th><th></th></tr></thead>
            <tbody>{rows.map((m) => (
              <tr key={m.id}>
                <td className="text-xs">{fmtDateTime(m.occurredAt)}</td>
                <td className="font-mono text-xs">{m.number}</td>
                <td><StatusBadge status={m.type} /></td>
                <td>{m.item.name}</td>
                <td className="text-xs">{m.location.name}</td>
                <td className={`num ${D(m.quantity).isNegative() ? "text-berry-700" : "text-mint-700"}`}>{formatQty(m.quantity, 4)} {UOM_LABEL[m.item.uom]}</td>
                <td className="num">{formatQty(m.balanceAfter, 3)}</td>
                <td className="num"><Peso v={m.unitCost} /></td>
                <td className="max-w-xs text-xs">{m.reason}{m.sourceType && m.sourceType !== "Manual" && <div className="text-choco-500">{m.sourceType}</div>}</td>
                <td className="text-xs">{users.find((u) => u.id === m.createdById)?.name ?? "system"}</td>
                <td>{can(user.role, "inventory:write") && m.sourceType === "Manual" && !m.groupId && m.type !== "REVERSAL" && !m.reversedBy && (
                  <ConfirmAction action={reverseMovementAction} label="Reverse" size="sm" variant="secondary" title={`Reverse ${m.number}?`} description="Posts an equal and opposite REVERSAL movement. The original stays in history." hidden={{ id: m.id }} reasonLabel="Reason" reasonRequired />
                )}{m.reversedBy && <span className="text-xs text-choco-500">reversed</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <Pagination page={page} pageSize={50} total={total} params={{ from: r.fromText, to: r.toText, locationId, itemId, type }} />
    </div>
  );
}
