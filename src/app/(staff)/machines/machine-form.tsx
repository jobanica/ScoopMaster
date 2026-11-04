import type { Machine } from "@prisma/client";
import { ActionForm, DateField, Field, SelectField, SubmitButton, TextArea } from "@/components/forms";
import { fmtDate } from "@/lib/dates";
import type { ActionState } from "@/lib/action";

export function MachineForm({ action, m }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; m?: Machine }) {
  return (
    <ActionForm action={action}>
      {m && <input type="hidden" name="id" value={m.id} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Brand" name="brand" defaultValue={m?.brand} required />
        <Field label="Model" name="model" defaultValue={m?.model} required />
        <Field label="Machine type" name="machineType" defaultValue={m?.machineType} placeholder="Countertop / floor" />
        <Field label="Number of nozzles" name="nozzles" type="number" min="1" max="10" defaultValue={m?.nozzles ?? 3} required />
        <Field label="Serial number" name="serialNumber" defaultValue={m?.serialNumber} required />
        <SelectField label="Condition" name="condition" defaultValue={m?.condition ?? "NEW"} options={["NEW", "GOOD", "FAIR", "POOR", "DEFECTIVE"].map((c) => ({ value: c, label: c[0] + c.slice(1).toLowerCase() }))} />
        <DateField label="Purchase date" name="purchaseDate" defaultValue={m?.purchaseDate ? fmtDate(m.purchaseDate) : ""} />
        <Field label="Purchase price (₱)" name="purchasePrice" defaultValue={m?.purchasePrice.toString() ?? "0"} />
        <DateField label="Warranty expiration" name="warrantyExpiry" defaultValue={m?.warrantyExpiry ? fmtDate(m.warrantyExpiry) : ""} />
        <DateField label="Next maintenance" name="nextMaintenanceDate" defaultValue={m?.nextMaintenanceDate ? fmtDate(m.nextMaintenanceDate) : ""} />
      </div>
      <TextArea label="Notes" name="notes" defaultValue={m?.notes} />
      <SubmitButton>{m ? "Save changes" : "Add machine"}</SubmitButton>
    </ActionForm>
  );
}
