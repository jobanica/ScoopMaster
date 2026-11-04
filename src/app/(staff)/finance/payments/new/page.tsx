import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDate, todayDate } from "@/lib/dates";
import { one, type SP } from "@/lib/params";
import { balanceOf } from "@/lib/calc/payments";
import { Card, Empty, FilterBar, FilterField, PageHeader, Peso, humanize } from "@/components/ui";
import { ActionForm, DateField, Field, SelectField, SubmitButton, TextArea } from "@/components/forms";
import { recordPaymentAction } from "../../actions";

export const metadata = { title: "Record payment" };
export default async function NewPaymentPage({ searchParams }: { searchParams: SP }) {
  await requirePage("payments:write");
  const sp = await searchParams;
  const direction = one(sp.direction) === "OUT" ? "OUT" : "IN";
  const partnerId = one(sp.partnerId);
  const contactId = one(sp.contactId);
  const payee = one(sp.payee);
  const preInvoice = one(sp.invoiceId);
  const preBill = one(sp.billId);
  const [partners, contacts] = await Promise.all([prisma.partner.findMany({ orderBy: { businessName: "asc" } }), prisma.contact.findMany({ where: { isActive: true }, orderBy: { name: "asc" } })]);
  const party = partnerId || contactId || payee;
  const docs = !party ? [] : direction === "IN"
    ? (await prisma.invoice.findMany({ where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] }, ...(partnerId ? { partnerId } : contactId ? { contactId } : { id: "none" }) }, orderBy: { dueDate: "asc" } })).map((d) => ({ id: d.id, number: d.number, label: humanize(d.type), desc: d.description, due: d.dueDate, balance: balanceOf(d), pre: d.id === preInvoice }))
    : (await prisma.bill.findMany({ where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] }, ...(partnerId ? { partnerId } : contactId ? { contactId } : payee ? { payeeName: payee, contactId: null, partnerId: null } : { id: "none" }) }, orderBy: { dueDate: "asc" } })).map((d) => ({ id: d.id, number: d.number, label: humanize(d.category), desc: d.description, due: d.dueDate, balance: balanceOf(d), pre: d.id === preBill }));
  const preAmount = docs.find((d) => d.pre)?.balance.toString();
  return (
    <div className="max-w-4xl">
      <PageHeader title={direction === "IN" ? "Record payment received" : "Record payment made"} back={{ href: "/finance/payments", label: "Payments" }} subtitle="Partial payments are allowed. Unapplied amounts stay on the payment as a credit you can apply later." />
      <FilterBar>
        <FilterField label="Direction"><select className="input" name="direction" defaultValue={direction}><option value="IN">Received (receivable)</option><option value="OUT">Paid out (payable)</option></select></FilterField>
        <FilterField label="Partner"><select className="input" name="partnerId" defaultValue={partnerId ?? ""}><option value="">—</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.businessName}</option>)}</select></FilterField>
        <FilterField label="…or contact"><select className="input" name="contactId" defaultValue={contactId ?? ""}><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></FilterField>
      </FilterBar>
      {!party ? <Empty>Choose who the payment is from / to, then press Apply.</Empty> : (
        <Card>
          <ActionForm action={recordPaymentAction}>
            <input type="hidden" name="direction" value={direction} />
            {partnerId && <input type="hidden" name="partnerId" value={partnerId} />}
            {contactId && <input type="hidden" name="contactId" value={contactId} />}
            {payee && <input type="hidden" name="partyName" value={payee} />}
            <div className="grid gap-4 sm:grid-cols-4">
              <DateField label="Payment date" name="paymentDate" required defaultValue={fmtDate(todayDate())} />
              <Field label="Amount (₱)" name="amount" required defaultValue={preAmount} />
              <SelectField label="Method" name="method" options={[{ value: "CASH", label: "Cash" }, { value: "GCASH", label: "GCash" }, { value: "BANK_TRANSFER", label: "Bank transfer" }, { value: "OTHER", label: "Other" }]} />
              <Field label="Reference no." name="reference" />
            </div>
            <div className="card overflow-hidden">
              <table className="tbl"><thead><tr><th>Open document</th><th>Due</th><th className="num">Balance</th><th className="num">Apply</th></tr></thead>
                <tbody>{docs.length === 0 ? <tr><td colSpan={4} className="text-choco-500">No open documents — the payment will be recorded as unapplied credit.</td></tr> : docs.map((d) => (
                  <tr key={d.id}><td>{d.number} <span className="text-xs text-choco-500">{d.label} · {d.desc}</span></td><td>{fmtDate(d.due)}</td><td className="num"><Peso v={d.balance} /></td><td className="num"><input className="input w-32 text-right" name={`alloc_${d.id}`} defaultValue={d.pre ? d.balance.toString() : ""} /></td></tr>
                ))}</tbody></table>
            </div>
            <TextArea label="Notes" name="notes" rows={2} />
            <SubmitButton>Record payment</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
