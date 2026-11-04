import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDate, todayDate } from "@/lib/dates";
import { Card, PageHeader, humanize } from "@/components/ui";
import { ActionForm, Checkbox, DateField, Field, SelectField, SubmitButton } from "@/components/forms";
import { recordExpenseAction } from "../actions";

export const metadata = { title: "Record expense" };
const CATS = ["INGREDIENT_PURCHASE", "PACKAGING_PURCHASE", "TRANSPORTATION", "DELIVERY", "MACHINE_REPAIR", "MAINTENANCE", "SALARIES", "MARKETING", "UTILITIES", "RENT", "MACHINE_PURCHASE", "OTHER"];
export default async function Page() {
  await requirePage("finance:write");
  const contacts = await prisma.contact.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Record expense / bill" back={{ href: "/finance/payables", label: "Payables" }} subtitle="Every expense is recorded once as a bill. Tick 'paid now' for cash expenses; otherwise it stays in Accounts Payable." />
      <Card>
        <ActionForm action={recordExpenseAction}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Category" name="category" required options={CATS.map((c) => ({ value: c, label: humanize(c) }))} />
            <SelectField label="Payee (contact)" name="contactId" placeholder="— or type a name below —" options={contacts.map((c) => ({ value: c.id, label: `${c.name} (${humanize(c.type)})` }))} />
            <Field label="Payee name (if not a contact)" name="payeeName" />
            <Field label="Amount (₱)" name="amount" required />
            <div className="sm:col-span-2"><Field label="Description" name="description" required /></div>
            <DateField label="Bill / expense date" name="billDate" required defaultValue={fmtDate(todayDate())} />
            <DateField label="Due date" name="dueDate" hint="Defaults to the bill date" />
            <Field label="Payment terms" name="paymentTerms" placeholder="e.g. Net 30" />
          </div>
          <div className="rounded-xl bg-cream-100 p-4">
            <Checkbox label="Paid now" name="paidNow" hint="Records the payment immediately" />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <SelectField label="Payment method" name="method" options={[{ value: "CASH", label: "Cash" }, { value: "GCASH", label: "GCash" }, { value: "BANK_TRANSFER", label: "Bank transfer" }, { value: "OTHER", label: "Other" }]} />
              <Field label="Reference" name="reference" />
            </div>
          </div>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
