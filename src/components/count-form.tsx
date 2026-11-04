"use client";
import { useMemo, useState } from "react";
import Decimal from "decimal.js";
import type { ActionState } from "@/lib/action";
import { PendingProvider, SubmitButton, useActionSubmit } from "./forms";

export type CountRow = { itemId: string; name: string; uom: string; expected: string; opening: string; received: string; unitValue: string; isContainer: boolean; required: boolean; productId?: string; productName?: string; price?: string };
type Initial = { closing: Record<string, string>; wasted: Record<string, string>; cashSales: string; gcashSales: string; otherSales: string; actualCash: string; discounts: string; refunds: string; notes: string };

const peso = (d: Decimal) => (d.isNegative() ? "-₱" : "₱") + d.abs().toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const dec = (s: string | undefined) => { try { return new Decimal((s || "0").replace(/[,₱\s]/g, "")); } catch { return new Decimal(0); } };

/** Closing inventory count. Preview only — the server recalculates everything from the ledger. */
export function CountReportForm({ action, rows, consumption, ownerPct, reportDate, partnerId, initial, audience }: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>; rows: CountRow[]; consumption: Record<string, Record<string, string>>; ownerPct: string;
  reportDate: string; partnerId?: string; initial: Initial; audience: "partner" | "staff";
}) {
  const { state, pending, onSubmit } = useActionSubmit(action);
  const [closing, setClosing] = useState<Record<string, string>>(initial.closing);
  const [wasted, setWasted] = useState<Record<string, string>>(initial.wasted);
  const [pay, setPay] = useState({ cashSales: initial.cashSales, gcashSales: initial.gcashSales, otherSales: initial.otherSales, actualCash: initial.actualCash, discounts: initial.discounts, refunds: initial.refunds });

  const calc = useMemo(() => {
    const sold: Record<string, number> = {};
    let sales = new Decimal(0);
    const warnings: string[] = [];
    for (const r of rows.filter((x) => x.isContainer && x.productId)) {
      if (closing[r.itemId] === undefined || closing[r.itemId] === "") continue;
      const used = dec(r.expected).minus(dec(closing[r.itemId]));
      const s = used.minus(dec(wasted[r.itemId]));
      if (used.isNegative()) warnings.push(`${r.name}: more counted than expected`);
      const n = Math.max(0, s.toNumber());
      sold[r.productId!] = (sold[r.productId!] ?? 0) + n;
      sales = sales.plus(dec(r.price).times(n));
    }
    let cost = new Decimal(0);
    const usage: Record<string, Decimal> = {};
    for (const r of rows) {
      const counted = closing[r.itemId] !== undefined && closing[r.itemId] !== "";
      const used = counted ? Decimal.max(0, dec(r.expected).minus(dec(closing[r.itemId]))) : Object.entries(sold).reduce((a, [pid, q]) => a.plus(dec(consumption[pid]?.[r.itemId]).times(q)), new Decimal(0));
      usage[r.itemId] = used;
      cost = cost.plus(used.times(dec(r.unitValue)));
    }
    const net = sales.minus(dec(pay.discounts)).minus(dec(pay.refunds));
    const gp = net.minus(cost);
    const owner = gp.times(dec(ownerPct)).dividedBy(100).toDecimalPlaces(2);
    const expectedCash = net.minus(dec(pay.gcashSales)).minus(dec(pay.otherSales));
    const actual = pay.actualCash ? dec(pay.actualCash) : dec(pay.cashSales);
    return { sold, sales, net, cost, gp, owner, partner: gp.minus(owner), units: Object.values(sold).reduce((a, b) => a + b, 0), expectedCash, cashVar: actual.minus(expectedCash), usage, warnings };
  }, [rows, closing, wasted, pay, consumption, ownerPct]);
  const p = (k: keyof typeof pay) => ({ name: k, value: pay[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPay({ ...pay, [k]: e.target.value }), className: "input text-right", inputMode: "decimal" as const });
  const products = rows.filter((r) => r.isContainer && r.productId);

  return (
    <PendingProvider pending={pending}>
      <form onSubmit={onSubmit} className="space-y-5">
        {partnerId && <input type="hidden" name="partnerId" value={partnerId} />}
        <input type="hidden" name="reportDate" value={reportDate} />
        {state?.error && <div role="alert" className="rounded-lg bg-berry-50 px-3 py-2 text-sm font-medium text-berry-700">{state.error}</div>}
        {state?.ok && <div role="status" className="rounded-lg bg-mint-50 px-3 py-2 text-sm font-medium text-mint-700">{state.message}</div>}

        <div className="card overflow-hidden">
          <div className="border-b border-choco-50 px-4 py-3"><h3 className="text-sm font-semibold">1. Count what is left at closing</h3><p className="text-xs text-choco-500">Count every cup and cone. Weigh or estimate the powder left (bags + opened). Enter broken or spilled items under &quot;wasted&quot;.</p></div>
          <ul className="divide-y divide-choco-50">{rows.map((r) => (
            <li key={r.itemId} className="grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] sm:items-center">
              <div className="col-span-2 sm:col-span-1">
                <input type="hidden" name="countItemId" value={r.itemId} />
                <span className="font-medium">{r.name}</span>{r.required && <span className="text-berry-700"> *</span>}
                <span className="block text-xs text-choco-500">{r.uom}{r.productName ? ` · sold as ${r.productName}` : r.required ? "" : " · optional"}</span>
              </div>
              <div className="text-sm sm:text-right"><span className="label sm:hidden">Should have</span><span className="tabular-nums text-choco-600">{new Decimal(r.expected).toDecimalPlaces(3).toString()}</span>
                <span className="block text-[11px] text-choco-400">opening {new Decimal(r.opening).toDecimalPlaces(3).toString()}{!new Decimal(r.received).isZero() && <> + received {new Decimal(r.received).toDecimalPlaces(3).toString()}</>}</span></div>
              <div className="text-sm sm:text-right"><span className="label sm:hidden">Used</span><span className="tabular-nums font-semibold">{calc.usage[r.itemId] ? calc.usage[r.itemId].toDecimalPlaces(3).toString() : "—"}</span></div>
              <label className="block"><span className="label">Counted left</span><input className="input text-right" name={`closing_${r.itemId}`} inputMode="decimal" value={closing[r.itemId] ?? ""} onChange={(e) => setClosing({ ...closing, [r.itemId]: e.target.value })} placeholder={r.required ? "count" : "skip"} /></label>
              <label className="block"><span className="label">Wasted</span><input className="input text-right" name={`wasted_${r.itemId}`} inputMode="decimal" value={wasted[r.itemId] ?? ""} onChange={(e) => setWasted({ ...wasted, [r.itemId]: e.target.value })} placeholder="0" /></label>
            </li>
          ))}</ul>
          {calc.warnings.length > 0 && <p className="px-4 py-2 text-xs font-semibold text-berry-700">{calc.warnings.join(" · ")}</p>}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="card space-y-3 p-4">
            <h3 className="text-sm font-semibold">2. Money collected today</h3>
            <div className="grid grid-cols-2 gap-3">
              <label><span className="label">Cash</span><input {...p("cashSales")} /></label>
              <label><span className="label">GCash</span><input {...p("gcashSales")} /></label>
              <label><span className="label">Other</span><input {...p("otherSales")} /></label>
              <label><span className="label">Cash counted</span><input {...p("actualCash")} placeholder="= cash" /></label>
              <label><span className="label">Discounts given</span><input {...p("discounts")} /></label>
              <label><span className="label">Refunds</span><input {...p("refunds")} /></label>
            </div>
          </div>
          <div className="card space-y-1.5 p-4 text-sm">
            <h3 className="mb-1 text-sm font-semibold">Today&apos;s result (preview)</h3>
            {products.map((r) => <Row key={r.itemId} k={`${r.productName} × ${calc.sold[r.productId!] ?? 0}`} v={peso(dec(r.price).times(calc.sold[r.productId!] ?? 0))} />)}
            <Row k={`Net sales (${calc.units} sold)`} v={peso(calc.net)} bold />
            <Row k="Cost of cups, cones & powder used" v={peso(calc.cost.negated())} />
            <Row k="Gross profit" v={peso(calc.gp)} bold />
            <Row k={audience === "partner" ? "Scoop Master share" : "My share"} v={peso(calc.owner)} />
            <Row k={audience === "partner" ? "Your share" : "Partner share"} v={peso(calc.partner)} />
            <hr className="my-2 border-choco-50" />
            <Row k="Expected cash" v={peso(calc.expectedCash)} />
            <Row k={calc.cashVar.isNegative() ? "Cash short" : "Cash over"} v={peso(calc.cashVar)} warn={!calc.cashVar.isZero()} />
          </div>
        </div>
        <label className="block"><span className="label">Notes</span><textarea className="input" name="notes" rows={2} defaultValue={initial.notes} /></label>
        <div className="flex flex-wrap gap-2">
          <SubmitButton name="intent" value="submit" pendingText="Submitting…">Submit closing count</SubmitButton>
          <SubmitButton name="intent" value="draft" className="btn-secondary">Save draft</SubmitButton>
        </div>
        <p className="text-xs text-choco-500">Sales are calculated from what was used. Once submitted the count is locked and updates the stock records; corrections need approval.</p>
      </form>
    </PendingProvider>
  );
}

function Row({ k, v, bold, warn }: { k: string; v: string; bold?: boolean; warn?: boolean }) {
  return <div className="flex justify-between gap-2"><span className="text-choco-600">{k}</span><span className={`tabular-nums ${bold ? "font-bold" : ""} ${warn ? "font-semibold text-berry-700" : ""}`}>{v}</span></div>;
}
