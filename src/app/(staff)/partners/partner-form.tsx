import type { Partner } from "@prisma/client";
import { ActionForm, DateField, Field, SelectField, SubmitButton, TextArea } from "@/components/forms";
import { fmtDate } from "@/lib/dates";
import type { ActionState } from "@/lib/action";

export function PartnerForm({ action, partner }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; partner?: Partner }) {
  return (
    <ActionForm action={action}>
      {partner && <input type="hidden" name="id" value={partner.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" name="businessName" defaultValue={partner?.businessName} required />
        <Field label="Owner's name" name="ownerName" defaultValue={partner?.ownerName} required />
        <Field label="Contact number" name="contactNumber" defaultValue={partner?.contactNumber} placeholder="09XX XXX XXXX" />
        <Field label="Email address" name="email" type="email" defaultValue={partner?.email} />
        <Field label="Business address" name="address" defaultValue={partner?.address} />
        <Field label="Location / area" name="area" defaultValue={partner?.area} placeholder="City / municipality" />
        <DateField label="Partnership start date" name="startDate" defaultValue={partner?.startDate ? fmtDate(partner.startDate) : ""} />
        {!partner && <SelectField label="Initial status" name="status" defaultValue="PROSPECT" options={[{ value: "PROSPECT", label: "Prospect" }, { value: "PENDING_APPROVAL", label: "Pending approval" }]} />}
      </div>
      <TextArea label="Notes" name="notes" defaultValue={partner?.notes} />
      <SubmitButton>{partner ? "Save changes" : "Create partner"}</SubmitButton>
    </ActionForm>
  );
}
