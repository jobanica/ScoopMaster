import { requirePartner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDate, todayDate } from "@/lib/dates";
import { balanceOf } from "@/lib/calc/payments";
import { Card, Empty, PageHeader, Peso } from "@/components/ui";
import { ActionForm, DateField, Field, SelectField, SubmitButton, TextArea } from "@/components/forms";
import { partnerPaymentAction } from "../../actions";

export const metadata = { title: "Submit payment" };
export default async function PortalPayment() {
  const user = await requirePartner();
  const open = await prisma.invoice.findMany({ where: { partnerId: user.partnerId, status: { in: ["UNPAID", "PARTIALLY_PAID"] } }, orderBy: { dueDate: "asc" } });
  return (
    <div>
      <PageHeader title="Submit proof of payment" back={{ href: "/portal/invoices", label: "Invoices" }} />
      {open.length === 0 ? <Empty>You have no open invoices.</Empty> : (
        <Card>
          <ActionForm action={partnerPaymentAction}>
            <div className="grid grid-cols-2 gap-3">
              <DateField label="Payment date" name="paymentDate" required defaultValue={fmtDate(todayDate())} />
              <Field label="Amount paid (₱)" name="amount" required />
              <SelectField label="Method" name="method" defaultValue="GCASH" options={[{ value: "GCASH", label: "GCash" }, { value: "BANK_TRANSFER", label: "Bank transfer" }, { value: "CASH", label: "Cash" }, { value: "OTHER", label: "Other" }]} />
              <Field label="Reference no." name="reference" placeholder="GCash ref / deposit slip" />
            </div>
            <div className="card overflow-hidden"><table className="tbl tbl-stack"><thead><tr><th>Invoice</th><th className="num">Balance</th><th className="num">Pay</th></tr></thead>
              <tbody>{open.map((i) => <tr key={i.id}><td className="stack-title">{i.number}<div className="text-xs text-choco-500">due {fmtDate(i.dueDate)}</div></td><td data-label="Balance" className="num"><Peso v={balanceOf(i)} /></td><td data-label="Pay" className="num"><input className="input w-28 text-right" name={`alloc_${i.id}`} inputMode="decimal" /></td></tr>)}</tbody></table></div>
            <label className="block"><span className="label">Proof of payment *</span><input type="file" name="proof" accept="image/png,image/jpeg,image/webp,application/pdf" required className="text-sm" /><span className="mt-1 block text-xs text-choco-500">Photo or screenshot of the GCash/bank receipt (max 10 MB)</span></label>
            <TextArea label="Notes" name="notes" rows={2} />
            <SubmitButton>Submit payment</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
