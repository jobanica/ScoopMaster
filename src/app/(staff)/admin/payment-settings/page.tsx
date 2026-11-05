import { requirePage } from "@/lib/auth";
import { getPaymentSettings } from "@/server/services/settings";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, Checkbox, Field, SubmitButton, TextArea } from "@/components/forms";
import { PaymentQr } from "@/components/payment-qr";
import { savePaymentSettingsAction } from "./actions";

export const metadata = { title: "Payment details" };
export default async function PaymentSettingsPage() {
  await requirePage("finance:write");
  const s = await getPaymentSettings();
  return (
    <div>
      <PageHeader title="Payment details" subtitle="The QR code and account details partners see when they pay Scoop Master." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Edit">
          <ActionForm action={savePaymentSettingsAction}>
            <label className="block"><span className="label">Payment QR code (InstaPay / GCash)</span><input type="file" name="qr" accept="image/png,image/jpeg,image/webp" className="text-sm" />
              <span className="mt-1 block text-xs text-choco-500">{s.custom ? "A custom QR is uploaded." : "Using the default InstaPay QR."} Upload a new image to replace it.</span></label>
            {s.custom && <Checkbox label="Go back to the default QR" name="resetQr" />}
            <Field label="Account name" name="accountName" defaultValue={s.accountName} placeholder="e.g. Scoop Master / Juan Dela Cruz" />
            <Field label="Account / mobile number" name="accountNumber" defaultValue={s.accountNumber} placeholder="e.g. GCash 0917 123 4567" />
            <TextArea label="Instructions for partners (optional)" name="instructions" defaultValue={s.instructions} rows={3} />
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Card>
        <div><p className="label mb-2">Partner preview</p><PaymentQr amount="1577.50" /></div>
      </div>
    </div>
  );
}
