import { UOM_LABEL } from "@/lib/units";
import { formatPHP } from "@/lib/money";
import type { InventoryItem } from "@prisma/client";

/** Item + quantity rows for a supply request (server-rendered, fixed number of rows). */
export function SupplyLineInputs({ items, rows = 8, showPrice = true }: { items: InventoryItem[]; rows?: number; showPrice?: boolean }) {
  return (
    <div className="card overflow-hidden">
      <table className="tbl">
        <thead><tr><th>Item</th><th className="num">Quantity</th></tr></thead>
        <tbody>{Array.from({ length: rows }, (_, i) => (
          <tr key={i}>
            <td><input type="hidden" name="row" value={i} />
              <select className="input" name={`item_${i}`} defaultValue=""><option value="">—</option>{items.map((it) => <option key={it.id} value={it.id}>{it.name} — per {UOM_LABEL[it.uom]}{showPrice ? ` · ${formatPHP(it.partnerPrice)}` : ""}</option>)}</select></td>
            <td className="num"><input className="input w-28 text-right" name={`qty_${i}`} inputMode="decimal" /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
