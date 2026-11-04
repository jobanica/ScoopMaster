import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePartner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { D, formatQty } from "@/lib/money";
import { UOM_LABEL } from "@/lib/units";
import { Card, PageHeader, Peso, StatusBadge } from "@/components/ui";
import { ActionForm, ConfirmAction, SubmitButton, TextArea } from "@/components/forms";
import { partnerCancelSupplyAction, partnerReceiveAction } from "../../actions";

export default async function PortalSupplyDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePartner();
  const o = await prisma.supplyOrder.findUnique({ where: { id: (await params).id }, include: { lines: { include: { item: true } }, invoice: true } });
  if (!o || o.partnerId !== user.partnerId) notFound();
  const receiving = o.status === "DISPATCHED";
  return (
    <div className="space-y-4">
      <PageHeader title={`Request ${o.number}`} back={{ href: "/portal/supply-requests", label: "Supply requests" }} subtitle={<StatusBadge status={o.status} />}
        actions={o.status === "REQUESTED" && <ConfirmAction action={partnerCancelSupplyAction} label="Cancel request" title="Cancel this request?" hidden={{ id: o.id }} variant="secondary" reasonLabel="Reason" reasonRequired />} />
      {o.reviewNotes && <p className="rounded-xl bg-vanilla-50 px-4 py-3 text-sm">Note from Scoop Master: {o.reviewNotes}</p>}
      <Card title={receiving ? "Confirm what you received" : "Items"} pad={false}>
        <ActionForm action={partnerReceiveAction} className="space-y-0">
          <input type="hidden" name="id" value={o.id} />
          <table className="tbl"><thead><tr><th>Item</th><th className="num">Requested</th><th className="num">Approved</th><th className="num">Received</th><th className="num">Price</th></tr></thead>
            <tbody>{o.lines.map((l) => (
              <tr key={l.id}><td>{l.item.name} <span className="text-xs text-choco-500">{UOM_LABEL[l.item.uom]}</span></td><td className="num">{formatQty(l.requestedQty)}</td><td className="num">{l.approvedQty !== null ? formatQty(l.approvedQty) : "—"}</td>
                <td className="num">{receiving && D(l.approvedQty ?? 0).gt(0) ? <input className="input w-20 text-right" name={`received_${l.id}`} defaultValue={l.approvedQty?.toString()} inputMode="decimal" /> : l.receivedQty !== null ? formatQty(l.receivedQty) : "—"}</td>
                <td className="num"><Peso v={l.unitPrice} /></td></tr>
            ))}</tbody></table>
          {receiving && <div className="space-y-3 p-4"><TextArea label="Notes (damaged or missing items)" name="notes" rows={2} /><SubmitButton>Confirm receipt</SubmitButton><p className="text-xs text-choco-500">Only received quantities are invoiced and added to your stock.</p></div>}
        </ActionForm>
      </Card>
      {o.invoice && <p className="text-sm">Invoice: <Link className="link" href="/portal/invoices">{o.invoice.number}</Link> · <Peso v={o.invoice.amount} /></p>}
    </div>
  );
}
