import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Card, Empty, PageHeader, humanize } from "@/components/ui";
import { ActionForm, Field, SelectField, SubmitButton, TextArea } from "@/components/forms";
import { FinanceTabs } from "../tabs";
import { saveContactAction } from "../actions";

export const metadata = { title: "Contacts" };
const TYPES = ["SUPPLIER", "CUSTOMER", "DELIVERY_PROVIDER", "TECHNICIAN", "EMPLOYEE", "INSTALLMENT_BUYER", "OTHER"];
export default async function ContactsPage() {
  const user = await requirePage("finance:read");
  const contacts = await prisma.contact.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] });
  const write = can(user.role, "finance:write");
  return (
    <div>
      <PageHeader title="Finance" subtitle="Suppliers, customers, technicians, employees and other debtors/creditors." />
      <FinanceTabs active="contacts" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" pad={false}>
          {contacts.length === 0 ? <div className="p-5"><Empty /></div> : (
            <div className="divide-y divide-choco-50">{contacts.map((c) => (
              <details key={c.id} className="px-5 py-3">
                <summary className="flex cursor-pointer items-center justify-between text-sm"><span className="font-medium">{c.name}</span><span className="text-xs text-choco-500">{humanize(c.type)} · {c.phone ?? ""} {c.email ?? ""}</span></summary>
                {write && <ActionForm action={saveContactAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="id" value={c.id} />
                  <SelectField label="Type" name="type" defaultValue={c.type} options={TYPES.map((t) => ({ value: t, label: humanize(t) }))} />
                  <Field label="Name" name="name" defaultValue={c.name} required />
                  <Field label="Contact person" name="contactPerson" defaultValue={c.contactPerson} />
                  <Field label="Phone" name="phone" defaultValue={c.phone} />
                  <Field label="Email" name="email" defaultValue={c.email} />
                  <Field label="Address" name="address" defaultValue={c.address} />
                  <div className="sm:col-span-2"><SubmitButton className="btn-secondary btn-sm">Save</SubmitButton></div>
                </ActionForm>}
              </details>
            ))}</div>
          )}
        </Card>
        {write && (
          <Card title="New contact">
            <ActionForm action={saveContactAction} resetOnSuccess>
              <SelectField label="Type" name="type" options={TYPES.map((t) => ({ value: t, label: humanize(t) }))} />
              <Field label="Name" name="name" required />
              <Field label="Contact person" name="contactPerson" />
              <Field label="Phone" name="phone" />
              <Field label="Email" name="email" type="email" />
              <Field label="Address" name="address" />
              <TextArea label="Notes" name="notes" rows={2} />
              <SubmitButton>Add contact</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </div>
  );
}
