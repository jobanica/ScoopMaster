import type { Partner, PartnerContract, Settlement } from "@prisma/client";
import { D, formatQty } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { Badge, Card, Peso, StatusBadge, humanize } from "./ui";

type Calc = {
  terms: Record<string, string | boolean | number>;
  salesReports: { id: string; number: string; date: string; gross: string; discounts: string; refunds: string; net: string }[];
  expenses: { id: string; number: string; date: string; description: string; amount: string; paidBy: string }[];
  supplies: { itemId: string; sku: string; name: string; uom: string; quantity: string; value: string; byType: Record<string, string> }[];
  supplyInvoicesInPeriod: { id: string; number: string; amount: string; markup: string }[];
  steps: string[];
  movementCount: number;
};

const MODEL = { PROFIT_SHARE: "Profit share", FIXED_FEE: "Fixed fee", FEE_PLUS_SHARE: "Fixed fee + profit share", REVENUE_SHARE: "Revenue share" } as Record<string, string>;

export function SettlementStatement({ s, audience }: { s: Settlement & { partner: Partner; contract: PartnerContract }; audience: "owner" | "partner" }) {
  const c = (s.calculation ?? {}) as unknown as Calc;
  const row = (label: string, v: unknown, opts: { bold?: boolean; neg?: boolean; indent?: boolean } = {}) => (
    <div className={`flex justify-between py-1.5 text-sm ${opts.bold ? "border-t border-choco-100 font-bold" : ""} ${opts.indent ? "pl-4 text-choco-600" : ""}`}>
      <span>{label}</span><Peso v={opts.neg ? D(v as string).negated() : (v as string)} />
    </div>
  );
  const net = D(s.netDueToOwner);
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-choco-500">SCOOP MASTER · Partnership settlement statement</p>
            <h2 className="mt-1 text-xl font-bold">{s.partner.businessName} <span className="font-mono text-sm text-choco-500">{s.partner.code}</span></h2>
            <p className="text-sm text-choco-600">Period {fmtDate(s.periodStart)} – {fmtDate(s.periodEnd)} · Statement {s.number}</p>
          </div>
          <div className="text-right text-sm"><StatusBadge status={s.status} />{s.finalizedAt && <p className="mt-1 text-xs text-choco-500">Finalized {fmtDateTime(s.finalizedAt)}</p>}</div>
        </div>
        <p className="mt-3 rounded-lg bg-cream-100 px-3 py-2 text-xs text-choco-700">
          Contract v{String(c.terms?.contractVersion ?? s.contract.version)} · {MODEL[String(c.terms?.shareModel ?? s.contract.shareModel)]} · Owner {String(c.terms?.ownerSharePct ?? s.contract.ownerSharePct)}% / Partner {String(c.terms?.partnerSharePct ?? s.contract.partnerSharePct)}%
          {D(s.fixedFee).gt(0) && <> · Fixed fee <Peso v={s.fixedFee} /></>} · Supplies valued at {c.terms?.cogsBasis === "OWNER_COST" ? "owner's cost" : "price charged to partner"} · Sales cash held by {c.terms?.cashCustody === "OWNER" ? "owner" : "partner"}
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Profit computation">
          {row("Gross sales", s.grossSales)}
          {row("Less discounts", s.discounts, { neg: true, indent: true })}
          {row("Less refunds", s.refunds, { neg: true, indent: true })}
          {row("Net sales", s.netSales, { bold: true })}
          {row("Less supplies consumed (from inventory ledger)", s.suppliesConsumed, { neg: true, indent: true })}
          {row("Less approved operating expenses", s.operatingExpenses, { neg: true, indent: true })}
          {row("Distributable profit", s.distributableProfit, { bold: true })}
        </Card>
        <Card title="Distribution">
          {D(s.fixedFee).gt(0) && row("Fixed fee (included in owner share)", s.fixedFee, { indent: true })}
          {row("Owner share", s.ownerShare, { bold: true })}
          {row("Partner share", s.partnerShare, { bold: true })}
          <div className="mt-3 rounded-xl bg-choco-50 p-3 text-sm">
            {net.gte(0) ? <>
              <div className="flex justify-between"><span>Owner share</span><Peso v={s.ownerShare} /></div>
              {D(s.ownerPaidExpenses).gt(0) && <div className="flex justify-between"><span>+ Expenses paid by owner (reimbursement)</span><Peso v={s.ownerPaidExpenses} /></div>}
              <div className="mt-1 flex justify-between border-t border-choco-100 pt-1 font-bold"><span>Partner remits to owner</span><Peso v={net} /></div>
            </> : <>
              <div className="flex justify-between"><span>Partner share</span><Peso v={s.partnerShare} /></div>
              {D(s.partnerPaidExpenses).gt(0) && <div className="flex justify-between"><span>+ Expenses paid by partner</span><Peso v={s.partnerPaidExpenses} /></div>}
              <div className="mt-1 flex justify-between border-t border-choco-100 pt-1 font-bold"><span>Owner pays partner</span><Peso v={net.negated()} /></div>
            </>}
          </div>
          {c.steps?.length > 0 && <details className="mt-3 text-xs text-choco-600"><summary className="cursor-pointer">Calculation steps</summary><ol className="mt-2 list-decimal space-y-1 pl-5">{c.steps.map((x, i) => <li key={i} className="font-mono">{x}</li>)}</ol></details>}
        </Card>
      </div>

      <Card title={`Sales included (${c.salesReports?.length ?? 0} approved reports)`} pad={false}>
        <div className="max-h-80 overflow-auto"><table className="tbl"><thead><tr><th>Date</th><th>Report</th><th className="num">Gross</th><th className="num">Discounts</th><th className="num">Refunds</th><th className="num">Net</th></tr></thead>
          <tbody>{(c.salesReports ?? []).map((r) => <tr key={r.id}><td>{fmtDate(r.date)}</td><td className="text-xs">{r.number}</td><td className="num"><Peso v={r.gross} /></td><td className="num"><Peso v={r.discounts} /></td><td className="num"><Peso v={r.refunds} /></td><td className="num"><Peso v={r.net} /></td></tr>)}</tbody></table></div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Supplies consumed (${c.movementCount ?? 0} ledger movements)`} pad={false}>
          <table className="tbl"><thead><tr><th>Item</th><th className="num">Used</th><th className="num">Value</th></tr></thead>
            <tbody>{(c.supplies ?? []).map((x) => <tr key={x.itemId}><td>{x.name}<div className="text-xs text-choco-500">{Object.entries(x.byType).map(([t, q]) => `${humanize(t)} ${formatQty(q, 3)}`).join(" · ")}</div></td><td className="num">{formatQty(x.quantity, 3)} {x.uom.toLowerCase()}</td><td className="num"><Peso v={x.value} /></td></tr>)}</tbody></table>
        </Card>
        <Card title="Operating expenses deducted" pad={false}>
          {(c.expenses ?? []).length === 0 ? <p className="p-5 text-sm text-choco-500">None.</p> : (
            <table className="tbl"><tbody>{c.expenses.map((e) => <tr key={e.id}><td>{fmtDate(e.date)}</td><td>{e.description}<div className="text-xs text-choco-500">{e.number} · paid by {e.paidBy.toLowerCase()}</div></td><td className="num"><Peso v={e.amount} /></td></tr>)}</tbody></table>
          )}
        </Card>
      </div>

      <Card title="Separate from this settlement (not deducted or shared)">
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div className="rounded-xl bg-vanilla-50 p-3">
            <p className="font-semibold">Supply invoices outstanding <Badge tone="vanilla">accounts receivable</Badge></p>
            <p className="text-xl font-bold"><Peso v={s.supplyInvoicesOutstanding} /></p>
            <p className="text-xs text-choco-600">Paid separately against each supply invoice. Supplies already used were deducted above at their consumed value — unpaid invoices are not deducted again.</p>
          </div>
          {audience === "owner" && (
            <div className="rounded-xl bg-mint-50 p-3">
              <p className="font-semibold">My supply markup in this period <Badge tone="mint">owner only</Badge></p>
              <p className="text-xl font-bold"><Peso v={s.supplyMarkupInPeriod} /></p>
              <p className="text-xs text-choco-600">Earned on {(c.supplyInvoicesInPeriod ?? []).length} supply invoice(s) issued in the period. Reported separately to avoid double counting.</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
