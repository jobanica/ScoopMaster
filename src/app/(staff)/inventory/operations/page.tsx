import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { UOM_LABEL } from "@/lib/units";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, DateField, Field, SelectField, SubmitButton } from "@/components/forms";
import { InventoryTabs } from "../subnav";
import { stockOperationAction } from "../actions";

export const metadata = { title: "Stock operations" };
export default async function OperationsPage() {
  await requirePage("inventory:write");
  const [items, locations] = await Promise.all([
    prisma.inventoryItem.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
  ]);
  const itemOpts = items.map((i) => ({ value: i.id, label: `${i.name} (${i.sku}, ${UOM_LABEL[i.uom]})` }));
  const locOpts = locations.filter((l) => l.type !== "IN_TRANSIT").map((l) => ({ value: l.id, label: l.name }));
  const whOpts = locations.filter((l) => l.type === "WAREHOUSE").map((l) => ({ value: l.id, label: l.name }));
  const partnerLocs = locations.filter((l) => l.type === "PARTNER").map((l) => ({ value: l.id, label: l.name }));
  return (
    <div>
      <PageHeader title="Inventory" subtitle="All operations create immutable movement records. Corrections are new movements, never edits." />
      <InventoryTabs active="operations" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Receive stock (purchase)">
          <ActionForm action={stockOperationAction} resetOnSuccess>
            <input type="hidden" name="op" value="RECEIPT" />
            <SelectField label="Item" name="itemId" options={itemOpts} required placeholder="Select item…" />
            <SelectField label="Warehouse" name="locationId" options={whOpts} defaultValue={whOpts[0]?.value} />
            <div className="grid grid-cols-2 gap-3"><Field label="Quantity" name="quantity" required /><Field label="Unit cost (₱)" name="unitCost" required /></div>
            <div className="grid grid-cols-2 gap-3"><Field label="Batch no." name="batchNo" /><DateField label="Expiry date" name="expiryDate" /></div>
            <Field label="Supplier reference / DR no." name="reference" />
            <SubmitButton>Receive</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-choco-500">Updates the weighted-average cost. To record the supplier bill, use Finance → Payables.</p>
        </Card>
        <Card title="Transfer between locations">
          <ActionForm action={stockOperationAction} resetOnSuccess>
            <input type="hidden" name="op" value="TRANSFER" />
            <SelectField label="Item" name="itemId" options={itemOpts} required placeholder="Select item…" />
            <div className="grid grid-cols-2 gap-3"><SelectField label="From" name="fromId" options={locOpts} required placeholder="—" /><SelectField label="To" name="toId" options={locOpts} required placeholder="—" /></div>
            <Field label="Quantity" name="quantity" required />
            <Field label="Reason" name="reason" />
            <SubmitButton>Transfer</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-choco-500">Supplies sold to partners should go through Supply Orders so they are invoiced.</p>
        </Card>
        <Card title="Damaged / expired / internal issue / return to supplier">
          <ActionForm action={stockOperationAction} resetOnSuccess>
            <SelectField label="Type" name="op" options={[{ value: "DAMAGED", label: "Damaged goods" }, { value: "EXPIRED", label: "Expired goods" }, { value: "ISSUE", label: "Internal issue (e.g. spare part used)" }, { value: "RETURN_OUT", label: "Return to supplier" }]} />
            <SelectField label="Item" name="itemId" options={itemOpts} required placeholder="Select item…" />
            <SelectField label="Location" name="locationId" options={locOpts} required placeholder="—" />
            <Field label="Quantity" name="quantity" required />
            <Field label="Reason" name="reason" required />
            <SubmitButton>Record</SubmitButton>
          </ActionForm>
        </Card>
        <div className="space-y-4">
          <Card title="Partner returns stock to warehouse">
            <ActionForm action={stockOperationAction} resetOnSuccess>
              <input type="hidden" name="op" value="RETURN" />
              <SelectField label="Item" name="itemId" options={itemOpts} required placeholder="Select item…" />
              <SelectField label="From partner location" name="locationId" options={partnerLocs} required placeholder="—" />
              <Field label="Quantity" name="quantity" required />
              <Field label="Reason" name="reason" required />
              <SubmitButton>Record return</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Stock adjustment (+/−)">
            <ActionForm action={stockOperationAction} resetOnSuccess>
              <input type="hidden" name="op" value="ADJUSTMENT" />
              <SelectField label="Item" name="itemId" options={itemOpts} required placeholder="Select item…" />
              <SelectField label="Location" name="locationId" options={locOpts} required placeholder="—" />
              <Field label="Quantity change" name="quantity" required hint="Negative to reduce, e.g. -2.5" />
              <Field label="Reason" name="reason" required />
              <SubmitButton>Adjust</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </div>
  );
}
