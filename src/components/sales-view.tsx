import { prisma } from "@/lib/db";
import { D, formatQty } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { Badge, Card, DL, Peso, StatusBadge } from "./ui";

export async function loadSalesReport(id: string) {
  return prisma.salesReport.findUnique({
    where: { id },
    include: {
      partner: true, machine: true, settlement: { select: { id: true, number: true, status: true } },
      lines: { include: { product: true } }, stockLines: { include: { item: true } },
      editRequests: { orderBy: { createdAt: "desc" } },
    },
  });
}
export type LoadedReport = NonNullable<Awaited<ReturnType<typeof loadSalesReport>>>;

export function SalesReportView({ r, showCost }: { r: LoadedReport; showCost: boolean }) {
  return (
    <div className="space-y-4">
      {r.hasDiscrepancy && <div className="rounded-xl bg-berry-50 px-4 py-3 text-sm text-berry-700"><b>Discrepancy:</b> {r.discrepancyNotes}</div>}
      {r.reviewNotes && <div className="rounded-xl bg-vanilla-50 px-4 py-3 text-sm text-vanilla-700"><b>Review notes:</b> {r.reviewNotes}</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Report" className="lg:col-span-2">
          <DL cols={3} items={[
            ["Partner", r.partner.businessName], ["Machine", r.machine?.code], ["Reporting date", fmtDate(r.reportDate)],
            ["Status", <span key="s"><StatusBadge status={r.status} /> {r.settlement && <Badge tone="sky">in {r.settlement.number}</Badge>}</span>], ["Source", r.source], ["Revision", r.revision],
            ["Submitted", fmtDateTime(r.submittedAt)], ["Reviewed", fmtDateTime(r.reviewedAt)], ["Notes", r.notes],
          ]} />
        </Card>
        <Card title="Totals">
          <div className="space-y-1.5 text-sm">
            {([
              ["Gross sales", r.grossSales], ["Discounts", D(r.discounts).negated()], ["Refunds", D(r.refunds).negated()], ["Net sales", r.netSales],
              ["Declared total", r.reportedTotal], ["Sales variance", r.salesVariance],
            ] as const).map(([k, v]) => <div key={k} className="flex justify-between"><span className="text-choco-600">{k}</span><Peso v={v} className={k === "Net sales" ? "font-bold" : ""} /></div>)}
            <hr className="my-2 border-choco-50" />
            {([["Cash", r.cashSales], ["GCash", r.gcashSales], ["Other", r.otherSales], ["Expected cash", r.expectedCash], ["Actual cash", r.actualCash], [D(r.cashVariance).isNegative() ? "Cash shortage" : "Cash overage", r.cashVariance]] as const).map(([k, v]) => (
              <div key={k} className="flex justify-between"><span className="text-choco-600">{k}</span><Peso v={v} /></div>
            ))}
            {showCost && <>
              <hr className="my-2 border-choco-50" />
              <div className="flex justify-between"><span className="text-choco-600">Est. ingredient cost</span><Peso v={r.estimatedCogs} /></div>
              <div className="flex justify-between"><span className="text-choco-600">Est. gross profit</span><Peso v={r.estimatedProfit} className="font-semibold" /></div>
            </>}
          </div>
        </Card>
      </div>
      <Card title={`Products sold · ${r.totalUnits} units · ${r.wastageUnits} wasted`} pad={false}>
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Wastage</th><th className="num">Price</th><th className="num">Total</th>{showCost && <th className="num">Unit cost (est.)</th>}</tr></thead>
          <tbody>{r.lines.map((l) => (
            <tr key={l.id}><td>{l.product.name}</td><td className="num">{l.quantity}</td><td className="num">{l.wastageQty}</td><td className="num"><Peso v={l.unitPrice} /></td><td className="num"><Peso v={l.lineTotal} /></td>{showCost && <td className="num"><Peso v={l.unitCost} /></td>}</tr>
          ))}</tbody>
        </table></div>
      </Card>
      {r.stockLines.length > 0 && (
        <Card title="Opening / closing inventory (as reported)" pad={false}>
          <table className="tbl"><thead><tr><th>Item</th><th className="num">Opening</th><th className="num">Received</th><th className="num">Closing</th><th className="num">Implied usage</th></tr></thead>
            <tbody>{r.stockLines.map((s) => (
              <tr key={s.id}><td>{s.item.name}</td><td className="num">{formatQty(s.opening, 3)}</td><td className="num">{formatQty(s.received, 3)}</td><td className="num">{formatQty(s.closing, 3)}</td><td className="num">{formatQty(D(s.opening).plus(D(s.received)).minus(D(s.closing)), 3)}</td></tr>
            ))}</tbody></table>
        </Card>
      )}
    </div>
  );
}
