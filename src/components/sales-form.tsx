"use client";
import { useMemo, useState } from "react";
import Decimal from "decimal.js";
import type { ActionState } from "@/lib/action";
import { PendingProvider, SubmitButton, useActionSubmit } from "./forms";

type Product = { id: string; code: string; name: string; price: string };
type Item = { id: string; name: string; uom: string };
type Initial = {
  reportDate: string; machineId?: string | null; discounts: string; refunds: string; reportedTotal: string; cashSales: string; gcashSales: string; otherSales: string; actualCash: string; notes: string;
  lines: Record<string, { quantity: number; wastageQty: number }>; stock: Record<string, { opening: string; received: string; closing: string }>;
};

const peso = (d: Decimal) => (d.isNegative() ? "-₱" : "₱") + d.abs().toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const dec = (s: string) => { try { return new Decimal((s || "0").replace(/[,₱\s]/g, "")); } catch { return new Decimal(0); } };

/** Daily sales entry (partners and staff). Live preview only — the server recomputes everything authoritatively. */
export function SalesReportForm({ action, products, machines, items, initial, partnerId }: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>; products: Product[]; machines: { id: string; code: string }[]; items: Item[]; initial: Initial; partnerId?: string;
}) {
  const { state, pending, onSubmit } = useActionSubmit(action);
  const [lines, setLines] = useState(initial.lines);
  const [money, setMoney] = useState({ discounts: initial.discounts, refunds: initial.refunds, cashSales: initial.cashSales, gcashSales: initial.gcashSales, otherSales: initial.otherSales, actualCash: initial.actualCash, reportedTotal: initial.reportedTotal });
  const calc = useMemo(() => {
    let gross = new Decimal(0); let units = 0;
    for (const p of products) { const q = lines[p.id]?.quantity ?? 0; gross = gross.plus(new Decimal(p.price).times(q)); units += q; }
    const net = gross.minus(dec(money.discounts)).minus(dec(money.refunds));
    const expectedCash = net.minus(dec(money.gcashSales)).minus(dec(money.otherSales));
    const paid = dec(money.cashSales).plus(dec(money.gcashSales)).plus(dec(money.otherSales));
    const actual = money.actualCash ? dec(money.actualCash) : dec(money.cashSales);
    return { gross, net, units, expectedCash, paymentDiff: paid.minus(net), cashVar: actual.minus(expectedCash) };
  }, [lines, money, products]);
  const setQ = (id: string, k: "quantity" | "wastageQty", v: string) => setLines({ ...lines, [id]: { quantity: lines[id]?.quantity ?? 0, wastageQty: lines[id]?.wastageQty ?? 0, [k]: Math.max(0, parseInt(v || "0", 10) || 0) } });
  const m = (k: keyof typeof money) => ({ name: k, value: money[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setMoney({ ...money, [k]: e.target.value }), className: "input text-right", inputMode: "decimal" as const });

  return (
    <PendingProvider pending={pending}>
    <form onSubmit={onSubmit} className="space-y-5">
      {partnerId && <input type="hidden" name="partnerId" value={partnerId} />}
      {state?.error && <div role="alert" className="rounded-lg bg-berry-50 px-3 py-2 text-sm font-medium text-berry-700">{state.error}</div>}
      {state?.ok && <div role="status" className="rounded-lg bg-mint-50 px-3 py-2 text-sm font-medium text-mint-700">{state.message}</div>}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block"><span className="label">Reporting date *</span><input className="input" name="reportDate" defaultValue={initial.reportDate} placeholder="DD/MM/YYYY" pattern="\d{2}/\d{2}/\d{4}" required /></label>
        {machines.length > 1 && (
          <label className="block"><span className="label">Machine *</span>
            <select className="input" name="machineId" defaultValue={initial.machineId ?? ""} required><option value="">Select…</option>{machines.map((mc) => <option key={mc.id} value={mc.id}>{mc.code}</option>)}</select>
          </label>
        )}
        {machines.length === 1 && <div><span className="label">Machine</span><p className="py-2 text-sm font-semibold">{machines[0].code}</p><input type="hidden" name="machineId" value={machines[0].id} /></div>}
      </div>

      <div className="card table-wrap">
        <table className="tbl tbl-stack">
          <thead><tr><th>Product</th><th className="num">Price</th><th className="num">Qty sold</th><th className="num">Wastage</th><th className="num">Total</th></tr></thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td className="stack-title">{p.name}<input type="hidden" name="productId" value={p.id} /></td>
                <td data-label="Price" className="num">{peso(new Decimal(p.price))}</td>
                <td data-label="Qty sold" className="num"><input className="input w-20 text-right" name={`qty_${p.id}`} inputMode="numeric" value={lines[p.id]?.quantity || ""} placeholder="0" onChange={(e) => setQ(p.id, "quantity", e.target.value)} /></td>
                <td data-label="Wastage" className="num"><input className="input w-20 text-right" name={`waste_${p.id}`} inputMode="numeric" value={lines[p.id]?.wastageQty || ""} placeholder="0" onChange={(e) => setQ(p.id, "wastageQty", e.target.value)} /></td>
                <td data-label="Total" className="num">{peso(new Decimal(p.price).times(lines[p.id]?.quantity ?? 0))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td className="font-semibold">Gross sales</td><td /><td className="num font-semibold">{calc.units} units</td><td /><td className="num font-bold">{peso(calc.gross)}</td></tr></tfoot>
        </table>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-3 p-4">
          <h3 className="text-sm font-semibold">Adjustments & payments</h3>
          <div className="grid grid-cols-2 gap-3">
            <label><span className="label">Discounts</span><input {...m("discounts")} /></label>
            <label><span className="label">Refunds</span><input {...m("refunds")} /></label>
            <label><span className="label">Cash sales</span><input {...m("cashSales")} /></label>
            <label><span className="label">GCash sales</span><input {...m("gcashSales")} /></label>
            <label><span className="label">Other payments</span><input {...m("otherSales")} /></label>
            <label><span className="label">Total sales you declare</span><input {...m("reportedTotal")} placeholder="= net sales" /></label>
            <label className="col-span-2"><span className="label">Actual cash submitted / counted</span><input {...m("actualCash")} placeholder="= cash sales" /></label>
          </div>
        </div>
        <div className="card space-y-2 p-4 text-sm">
          <h3 className="text-sm font-semibold">Summary (preview)</h3>
          <Row k="Net sales" v={peso(calc.net)} bold />
          <Row k="Expected cash" v={peso(calc.expectedCash)} />
          <Row k="Payment breakdown difference" v={peso(calc.paymentDiff)} warn={!calc.paymentDiff.isZero()} />
          <Row k={calc.cashVar.isNegative() ? "Cash shortage" : "Cash overage"} v={peso(calc.cashVar)} warn={!calc.cashVar.isZero()} />
          <p className="pt-2 text-xs text-choco-500">Differences are flagged for review. Final figures are calculated by the server using your configured prices.</p>
        </div>
      </div>

      {items.length > 0 && (
        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-semibold">Opening / closing inventory (optional)</summary>
          <div className="table-wrap mt-3"><table className="tbl tbl-stack">
            <thead><tr><th>Item</th><th className="num">Opening</th><th className="num">Received</th><th className="num">Closing</th></tr></thead>
            <tbody>{items.map((it) => (
              <tr key={it.id}><td className="stack-title">{it.name} <span className="text-xs text-choco-500">({it.uom})</span><input type="hidden" name="stockItemId" value={it.id} /></td>
                {(["opening", "received", "closing"] as const).map((k) => <td key={k} className="num" data-label={k[0].toUpperCase() + k.slice(1)}><input className="input w-24 text-right" name={`${k}_${it.id}`} defaultValue={initial.stock[it.id]?.[k] ?? ""} inputMode="decimal" /></td>)}
              </tr>
            ))}</tbody>
          </table></div>
        </details>
      )}

      <label className="block"><span className="label">Notes</span><textarea className="input" name="notes" rows={2} defaultValue={initial.notes} /></label>
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="intent" value="submit" pendingText="Submitting…">Submit report</SubmitButton>
        <SubmitButton name="intent" value="draft" className="btn-secondary">Save draft</SubmitButton>
      </div>
      <p className="text-xs text-choco-500">After submission the report is locked. Corrections require an approved edit request.</p>
    </form>
    </PendingProvider>
  );
}

function Row({ k, v, bold, warn }: { k: string; v: string; bold?: boolean; warn?: boolean }) {
  return <div className="flex justify-between"><span className="text-choco-600">{k}</span><span className={`tabular-nums ${bold ? "font-bold" : ""} ${warn ? "font-semibold text-berry-700" : ""}`}>{v}</span></div>;
}
