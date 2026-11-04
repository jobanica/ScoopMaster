import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { D, formatQty, Decimal } from "@/lib/money";
import { fmtDateTime } from "@/lib/dates";
import { UOM_LABEL } from "@/lib/units";
import { Card, DL, PageHeader, Peso, StatusBadge } from "@/components/ui";
import { ActionForm, ConfirmAction, SubmitButton, TextArea } from "@/components/forms";
import { cancelSupplyAction, dispatchAction, preparingAction, receiveAction, reviewSupplyAction } from "../actions";

export default async function SupplyOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("supply:read");
  const o = await prisma.supplyOrder.findUnique({ where: { id: (await params).id }, include: { partner: true, invoice: true, lines: { include: { item: { include: { stockLevels: { include: { location: true } } } } } } } });
  if (!o) notFound();
  const fin = can(user.role, "dashboard:financials") || can(user.role, "supply:review");
  const qtyOf = (l: (typeof o.lines)[number]) => D(l.receivedQty ?? l.approvedQty ?? l.requestedQty);
  const totals = o.lines.reduce((a, l) => ({ price: a.price.plus(qtyOf(l).times(D(l.unitPrice))), cost: a.cost.plus(qtyOf(l).times(D(l.unitCost))) }), { price: new Decimal(0), cost: new Decimal(0) });
  const whStock = (l: (typeof o.lines)[number]) => l.item.stockLevels.filter((s) => s.location.type === "WAREHOUSE").reduce((a, s) => a.plus(D(s.quantity)), new Decimal(0));
  const review = o.status === "REQUESTED" && can(user.role, "supply:review");
  const receiving = o.status === "DISPATCHED" && can(user.role, "supply:fulfil");

  const table = (mode: "view" | "review" | "receive") => (
    <div className="table-wrap"><table className="tbl">
      <thead><tr><th>Item</th><th className="num">Requested</th><th className="num">Approved</th><th className="num">Received</th>{mode === "review" && <th className="num">Warehouse stock</th>}{fin && <><th className="num">Unit cost</th><th className="num">Partner price</th><th className="num">Markup</th></>}<th className="num">Total</th></tr></thead>
      <tbody>{o.lines.map((l) => (
        <tr key={l.id}>
          <td>{l.item.name} <span className="text-xs text-choco-500">{UOM_LABEL[l.item.uom]}</span></td>
          <td className="num">{formatQty(l.requestedQty, 3)}</td>
          <td className="num">{mode === "review" ? <input className="input w-24 text-right" name={`approved_${l.id}`} defaultValue={l.requestedQty.toString()} /> : l.approvedQty !== null ? formatQty(l.approvedQty, 3) : "—"}</td>
          <td className="num">{mode === "receive" ? <input className="input w-24 text-right" name={`received_${l.id}`} defaultValue={l.approvedQty?.toString() ?? ""} /> : l.receivedQty !== null ? formatQty(l.receivedQty, 3) : "—"}</td>
          {mode === "review" && <td className={`num ${whStock(l).lt(D(l.requestedQty)) ? "text-berry-700" : ""}`}>{formatQty(whStock(l), 3)}</td>}
          {fin && <><td className="num"><Peso v={l.unitCost} /></td><td className="num"><Peso v={l.unitPrice} /></td><td className="num"><Peso v={qtyOf(l).times(D(l.unitPrice).minus(D(l.unitCost)))} /></td></>}
          <td className="num"><Peso v={qtyOf(l).times(D(l.unitPrice))} /></td>
        </tr>
      ))}</tbody>
      <tfoot><tr><td colSpan={mode === "review" ? 5 : 4} className="font-semibold">Totals</td>{fin && <><td className="num"><Peso v={totals.cost} /></td><td /><td className="num font-semibold text-mint-700"><Peso v={totals.price.minus(totals.cost)} /></td></>}<td className="num font-bold"><Peso v={totals.price} /></td></tr></tfoot>
    </table></div>
  );

  return (
    <div>
      <PageHeader title={`Supply order ${o.number}`} back={{ href: "/supply-orders", label: "Supply orders" }} subtitle={<span><Link className="link" href={`/partners/${o.partnerId}`}>{o.partner.businessName}</Link> · <StatusBadge status={o.status} /></span>} actions={<>
        {o.status === "APPROVED" && can(user.role, "supply:fulfil") && <ConfirmAction action={preparingAction} label="Mark preparing" title="Start preparing this order?" hidden={{ id: o.id }} variant="secondary" />}
        {["APPROVED", "PREPARING"].includes(o.status) && can(user.role, "supply:fulfil") && <ConfirmAction action={dispatchAction} label="Dispatch" title="Dispatch order?" description="Approved quantities leave the warehouse now and are held In Transit until the partner confirms receipt." hidden={{ id: o.id }} variant="success" />}
        {["REQUESTED", "APPROVED", "PREPARING"].includes(o.status) && can(user.role, "supply:review") && <ConfirmAction action={cancelSupplyAction} label="Cancel" title="Cancel order?" hidden={{ id: o.id }} variant="danger" reasonLabel="Reason" reasonRequired />}
      </>} />
      <div className="grid gap-4 lg:grid-cols-4">
        <Card title="Timeline">
          <DL cols={1} items={[["Requested", fmtDateTime(o.requestedAt)], ["Reviewed", fmtDateTime(o.approvedAt)], ["Dispatched", fmtDateTime(o.dispatchedAt)], ["Received", fmtDateTime(o.receivedAt)],
            ["Invoice", o.invoice ? <Link key="i" className="link" href={`/finance/invoices/${o.invoice.id}`}>{o.invoice.number}</Link> : "Generated on receipt"], ["Notes", o.notes], ["Review notes", o.reviewNotes]]} />
        </Card>
        <div className="lg:col-span-3">
          {review ? (
            <Card title="Review request">
              <ActionForm action={reviewSupplyAction}>
                <input type="hidden" name="id" value={o.id} />
                {table("review")}
                <TextArea label="Notes to partner" name="notes" rows={2} />
                <div className="flex gap-2"><SubmitButton name="decision" value="approve">Approve quantities</SubmitButton><SubmitButton name="decision" value="reject" className="btn-danger">Reject</SubmitButton></div>
                <p className="text-xs text-choco-500">Set a quantity to 0 to drop a line. Rejecting requires notes. Prices are fixed at approval.</p>
              </ActionForm>
            </Card>
          ) : receiving ? (
            <Card title="Confirm receipt (on behalf of partner)">
              <ActionForm action={receiveAction}>
                <input type="hidden" name="id" value={o.id} />
                {table("receive")}
                <TextArea label="Receipt notes (e.g. damaged items)" name="notes" rows={2} />
                <SubmitButton>Confirm receipt & invoice</SubmitButton>
              </ActionForm>
            </Card>
          ) : <Card title="Lines" pad={false}>{table("view")}</Card>}
        </div>
      </div>
    </div>
  );
}
