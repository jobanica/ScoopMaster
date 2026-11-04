import { requirePartner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDate, todayDate } from "@/lib/dates";
import { Card, Empty, PageHeader, Peso, StatusBadge } from "@/components/ui";
import { ActionForm, DateField, Field, SubmitButton } from "@/components/forms";
import { partnerExpenseAction } from "../actions";

export const metadata = { title: "Expenses" };
export default async function PortalExpenses() {
  const user = await requirePartner();
  const rows = await prisma.partnerExpense.findMany({ where: { partnerId: user.partnerId }, orderBy: { expenseDate: "desc" }, take: 60 });
  return (
    <div className="space-y-4">
      <PageHeader title="Operating expenses" subtitle="Approved expenses are deducted before profit sharing, per your agreement." />
      <Card title="Submit an expense">
        <ActionForm action={partnerExpenseAction} resetOnSuccess>
          <div className="grid grid-cols-2 gap-3">
            <DateField label="Date" name="expenseDate" required defaultValue={fmtDate(todayDate())} />
            <Field label="Amount (₱)" name="amount" required />
          </div>
          <Field label="Category" name="category" required placeholder="Electricity, LPG, cleaning…" />
          <Field label="Description" name="description" required />
          <SubmitButton>Submit</SubmitButton>
        </ActionForm>
      </Card>
      <Card title="My expenses" pad={false}>
        {rows.length === 0 ? <div className="p-5"><Empty /></div> : <ul className="divide-y divide-choco-50">{rows.map((e) => <li key={e.id} className="flex items-center justify-between px-4 py-3 text-sm"><span><span className="font-semibold">{e.category}</span><span className="block text-xs text-choco-500">{fmtDate(e.expenseDate)} · {e.description}</span>{e.reviewNotes && <span className="block text-xs text-choco-600">{e.reviewNotes}</span>}</span><span className="text-right"><Peso v={e.amount} /><div><StatusBadge status={e.status} /></div></span></li>)}</ul>}
      </Card>
    </div>
  );
}
