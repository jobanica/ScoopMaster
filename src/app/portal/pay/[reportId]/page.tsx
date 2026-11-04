import { notFound } from "next/navigation";
import { requirePartner } from "@/lib/auth";
import { fmtDate, todayDate } from "@/lib/dates";
import { dailyDue } from "@/server/services/daily-pay";
import { Alert, PageHeader } from "@/components/ui";
import { ActionForm, DateField, Field, SelectField, SubmitButton, TextArea } from "@/components/forms";
import { DailyPayCard } from "@/components/daily-pay-card";
import { partnerDailyPayAction } from "../../actions";

export const metadata = { title: "Pay today" };
export default async function DailyPayPage({ params }: { params: Promise<{ reportId: string }> }) {
  const user = await requirePartner();
  const due = await dailyDue(user.partnerId, (await params).reportId).catch(() => null);
  if (!due) notFound();
  return (
    <div className="space-y-4">
      <PageHeader title="Pay Scoop Master" subtitle={`${due.report.number} · ${fmtDate(due.report.reportDate)}`} back={{ href: `/portal/sales/${due.report.id}`, label: "Report" }} />
      <DailyPayCard due={due} audience="staff" />
      {due.status !== "DUE" ? <Alert tone="mint">Nothing to pay for this day right now.</Alert> : (
        <ActionForm action={partnerDailyPayAction} className="card space-y-4 p-4">
          <input type="hidden" name="reportId" value={due.report.id} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₱)" name="amount" required defaultValue={due.remaining.toFixed(2)} />
            <SelectField label="Paid by" name="method" defaultValue="GCASH" options={[{ value: "GCASH", label: "GCash" }, { value: "CASH", label: "Cash (handed over)" }, { value: "BANK_TRANSFER", label: "Bank transfer" }, { value: "OTHER", label: "Other" }]} />
            <DateField label="Date paid" name="paymentDate" required defaultValue={fmtDate(todayDate())} />
            <Field label="Reference no." name="reference" placeholder="GCash ref" />
          </div>
          <label className="block"><span className="label">Proof of payment</span><input type="file" name="proof" accept="image/png,image/jpeg,image/webp,application/pdf" className="text-sm" /><span className="mt-1 block text-xs text-choco-500">Required for GCash and bank transfers — a screenshot of the receipt.</span></label>
          <TextArea label="Notes" name="notes" rows={2} />
          <SubmitButton className="btn-success w-full text-base" pendingText="Sending…">Submit payment</SubmitButton>
          <p className="text-xs text-choco-500">Scoop Master verifies the payment; your balances update once it is confirmed.</p>
        </ActionForm>
      )}
    </div>
  );
}
