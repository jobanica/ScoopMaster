import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, todayDate } from "@/lib/dates";
import { one, type SP } from "@/lib/params";
import { Badge, Card, Empty, FilterBar, FilterField, PageHeader, Peso, StatusBadge, humanize } from "@/components/ui";
import { ActionForm, ConfirmAction, DateField, Field, SelectField, SubmitButton } from "@/components/forms";
import { FinanceTabs } from "../tabs";
import { reviewPartnerExpenseAction, staffPartnerExpenseAction } from "../actions";

export const metadata = { title: "Partner expenses" };
export default async function PartnerExpensesPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePage("finance:read");
  const status = one((await searchParams).status) ?? "PENDING";
  const [rows, partners] = await Promise.all([
    prisma.partnerExpense.findMany({ where: status === "ALL" ? {} : { status: status as never }, include: { partner: true }, orderBy: { expenseDate: "desc" }, take: 300 }),
    prisma.partner.findMany({ where: { status: { in: ["ACTIVE", "ON_HOLD"] } }, orderBy: { businessName: "asc" } }),
  ]);
  const review = can(user.role, "partnerExpenses:review");
  return (
    <div>
      <PageHeader title="Finance" subtitle="Operating expenses at partner locations. Approved expenses are deducted in profit sharing per contract — they are partnership costs, not owner bills, so they are never counted twice." />
      <FinanceTabs active="partner-expenses" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <FilterBar><FilterField label="Status"><select className="input" name="status" defaultValue={status}>{["PENDING", "APPROVED", "REJECTED", "ALL"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></FilterField></FilterBar>
          <Card pad={false}>
            {rows.length === 0 ? <div className="p-5"><Empty>Nothing here.</Empty></div> : (
              <div className="table-wrap"><table className="tbl">
                <thead><tr><th>Date</th><th>Partner</th><th>Expense</th><th>Paid by</th><th>Status</th><th className="num">Amount</th><th></th></tr></thead>
                <tbody>{rows.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtDate(e.expenseDate)}</td><td><Link className="link" href={`/partners/${e.partnerId}?tab=expenses`}>{e.partner.businessName}</Link></td>
                    <td>{e.category}<div className="text-xs text-choco-500">{e.number} · {e.description}</div></td><td>{humanize(e.paidBy)}</td>
                    <td><StatusBadge status={e.status} /> {e.settlementId && <Badge tone="sky">settled</Badge>}</td><td className="num"><Peso v={e.amount} /></td>
                    <td className="whitespace-nowrap">{review && e.status === "PENDING" && <div className="flex gap-1">
                      <ConfirmAction action={reviewPartnerExpenseAction} label="Approve" size="sm" variant="success" title="Approve expense?" description="It will be deducted in the partner's next settlement." hidden={{ id: e.id, decision: "approve" }} reasonLabel="Notes" />
                      <ConfirmAction action={reviewPartnerExpenseAction} label="Reject" size="sm" variant="secondary" title="Reject expense?" hidden={{ id: e.id, decision: "reject" }} reasonLabel="Reason" reasonRequired />
                    </div>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Card>
        </div>
        {review && (
          <Card title="Record partner expense">
            <ActionForm action={staffPartnerExpenseAction} resetOnSuccess>
              <SelectField label="Partner" name="partnerId" required placeholder="Select…" options={partners.map((p) => ({ value: p.id, label: p.businessName }))} />
              <DateField label="Date" name="expenseDate" required defaultValue={fmtDate(todayDate())} />
              <Field label="Category" name="category" required placeholder="Electricity, LPG, staff meal…" />
              <Field label="Description" name="description" required />
              <Field label="Amount (₱)" name="amount" required />
              <SelectField label="Paid by" name="paidBy" options={[{ value: "PARTNER", label: "Partner" }, { value: "OWNER", label: "Owner (reimbursed in settlement)" }]} />
              <SubmitButton>Record</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </div>
  );
}
