import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDate, todayDate } from "@/lib/dates";
import { Card, PageHeader, humanize } from "@/components/ui";
import { ActionForm, Checkbox, DateField, Field, SelectField, SubmitButton } from "@/components/forms";
import { recordIncomeAction } from "../actions";

export const metadata = { title: "Record income" };
export default async function Page() {
  await requirePage("finance:write");
  const [partners, contacts] = await Promise.all([prisma.partner.findMany({ orderBy: { businessName: "asc" } }), prisma.contact.findMany({ where: { isActive: true }, orderBy: { name: "asc" } })]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Record other income / receivable" back={{ href: "/finance/receivables", label: "Receivables" }} subtitle="Machine sales, rentals, installments and other income. Supply and partnership invoices are created automatically." />
      <Card>
        <ActionForm action={recordIncomeAction}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Type" name="type" options={["MACHINE_SALE", "MACHINE_RENTAL", "INSTALLMENT", "OTHER"].map((t) => ({ value: t, label: humanize(t) }))} />
            <div />
            <SelectField label="Partner" name="partnerId" placeholder="—" options={partners.map((p) => ({ value: p.id, label: p.businessName }))} />
            <SelectField label="…or contact" name="contactId" placeholder="—" options={contacts.map((c) => ({ value: c.id, label: `${c.name} (${humanize(c.type)})` }))} />
            <div className="sm:col-span-2"><Field label="Description" name="description" required /></div>
            <Field label="Quantity" name="quantity" defaultValue="1" />
            <Field label="Unit amount (₱)" name="unitPrice" required />
            <DateField label="Issue date" name="issueDate" required defaultValue={fmtDate(todayDate())} />
            <DateField label="Due date" name="dueDate" />
            <Field label="Payment terms" name="paymentTerms" />
          </div>
          <div className="rounded-xl bg-cream-100 p-4">
            <Checkbox label="Received now" name="receivedNow" />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <SelectField label="Method" name="method" options={[{ value: "CASH", label: "Cash" }, { value: "GCASH", label: "GCash" }, { value: "BANK_TRANSFER", label: "Bank transfer" }, { value: "OTHER", label: "Other" }]} />
              <Field label="Reference" name="reference" />
            </div>
          </div>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
