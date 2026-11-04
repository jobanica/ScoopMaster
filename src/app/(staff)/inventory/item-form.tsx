import type { InventoryItem } from "@prisma/client";
import { ActionForm, Checkbox, Field, SelectField, SubmitButton, TextArea } from "@/components/forms";
import { humanize } from "@/components/ui";
import { saveItemAction } from "./actions";

export const CATEGORIES = ["ICE_CREAM_POWDER", "CONES", "CUPS", "SPOONS", "TOPPINGS", "SYRUPS", "PACKAGING", "CLEANING", "SPARE_PARTS", "OTHER"];
export const UOMS = [["KG", "Kilograms"], ["G", "Grams"], ["L", "Liters"], ["ML", "Milliliters"], ["PC", "Pieces"], ["BOX", "Boxes"], ["PACK", "Packs"], ["BAG", "Bags"]];

export function ItemForm({ item, suppliers }: { item?: InventoryItem; suppliers: { id: string; name: string }[] }) {
  return (
    <ActionForm action={saveItemAction}>
      {item && <input type="hidden" name="id" value={item.id} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="SKU" name="sku" defaultValue={item?.sku} required />
        <div className="sm:col-span-2"><Field label="Product name" name="name" defaultValue={item?.name} required /></div>
        <SelectField label="Category" name="category" defaultValue={item?.category ?? "ICE_CREAM_POWDER"} options={CATEGORIES.map((c) => ({ value: c, label: humanize(c) }))} />
        <SelectField label="Unit of measurement" name="uom" defaultValue={item?.uom ?? "KG"} options={UOMS.map(([v, l]) => ({ value: v, label: l }))} />
        <SelectField label="Supplier" name="supplierId" defaultValue={item?.supplierId} placeholder="—" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
        <Field label="Purchase cost per unit (₱)" name="purchaseCost" defaultValue={item?.purchaseCost.toString() ?? "0"} hint={item ? `Weighted avg cost: ₱${item.avgCost.toString()}` : "Used as the initial average cost"} />
        <Field label="Selling price to partner (₱)" name="partnerPrice" defaultValue={item?.partnerPrice.toString() ?? "0"} />
        <div />
        <Field label="Warehouse minimum stock" name="minStock" defaultValue={item?.minStock.toString() ?? "0"} />
        <Field label="Partner location minimum" name="partnerMinStock" defaultValue={item?.partnerMinStock.toString() ?? "0"} />
      </div>
      <div className="flex flex-wrap gap-6">
        <Checkbox label="Perishable (track expiry & batches)" name="isPerishable" defaultChecked={item?.isPerishable} />
        <Checkbox label="Can be supplied to partners" name="isSellable" defaultChecked={item?.isSellable ?? true} />
        {item && <Checkbox label="Active" name="isActive" defaultChecked={item.isActive} />}
      </div>
      <TextArea label="Notes" name="notes" defaultValue={item?.notes} rows={2} />
      <SubmitButton>{item ? "Save item" : "Create item"}</SubmitButton>
    </ActionForm>
  );
}
