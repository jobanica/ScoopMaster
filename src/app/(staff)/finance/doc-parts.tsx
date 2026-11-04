import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { Card, Peso, StatusBadge, humanize } from "@/components/ui";

export async function PaymentHistory({ invoiceId, billId }: { invoiceId?: string; billId?: string }) {
  const allocs = await prisma.paymentAllocation.findMany({ where: invoiceId ? { invoiceId } : { billId }, include: { payment: true }, orderBy: { createdAt: "asc" } });
  return (
    <Card title="Payment history" pad={false}>
      {allocs.length === 0 ? <p className="p-5 text-sm text-choco-500">No payments yet.</p> : (
        <table className="tbl"><thead><tr><th>Payment</th><th>Date</th><th>Method</th><th>Reference</th><th>Status</th><th className="num">Applied</th></tr></thead>
          <tbody>{allocs.map((a) => (
            <tr key={a.id} className={a.payment.status === "CONFIRMED" ? "" : "opacity-60"}><td><Link className="link" href={`/finance/payments/${a.paymentId}`}>{a.payment.number}</Link></td><td>{fmtDate(a.payment.paymentDate)}</td><td>{humanize(a.payment.method)}</td><td className="text-xs">{a.payment.reference ?? "—"}</td><td><StatusBadge status={a.payment.status} /></td><td className="num"><Peso v={a.amount} /></td></tr>
          ))}</tbody></table>
      )}
    </Card>
  );
}
