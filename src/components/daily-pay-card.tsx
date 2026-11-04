import Link from "next/link";
import { fmtDate } from "@/lib/dates";
import type { dailyDue } from "@/server/services/daily-pay";
import { Badge, Card, Peso } from "./ui";

type Due = Awaited<ReturnType<typeof dailyDue>>;

/** Owner share + supplies used for one day, and the pay button (partner) or status (staff). */
export function DailyPayCard({ due, audience }: { due: Due; audience: "partner" | "staff" }) {
  const title = audience === "partner" ? `To pay Scoop Master for ${fmtDate(due.report.reportDate)}` : `Daily pay-in for ${fmtDate(due.report.reportDate)}`;
  return (
    <Card title={title} actions={
      due.status === "PAID" ? <Badge tone="mint">paid</Badge> : due.status === "PENDING" ? <Badge tone="vanilla">awaiting verification</Badge> : due.status === "WAITING" ? <Badge tone="gray">waiting for approval</Badge> : <Badge tone="berry">due</Badge>
    }>
      {due.status === "WAITING" ? (
        <p className="text-sm text-choco-600">{audience === "partner" ? "You can pay as soon as Scoop Master approves this report." : "Payable once the report is approved and the day is settled."}</p>
      ) : (
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between"><span className="text-choco-600">1. Scoop Master share{due.shareInvoice ? ` (${due.shareInvoice.number})` : ""}</span><Peso v={due.shareDue} /></div>
          <div className="flex justify-between"><span className="text-choco-600">2. Supplies used (cups, cones, powder)</span><Peso v={due.suppliesDue} /></div>
          <div className="flex justify-between border-t border-choco-100 pt-2 text-base font-bold"><span>Total</span><Peso v={due.total} /></div>
          {due.pending.gt(0) && <div className="flex justify-between text-vanilla-700"><span>Submitted, awaiting verification</span><Peso v={due.pending} /></div>}
          {due.status === "DUE" && audience === "partner" && (
            <Link href={`/portal/pay/${due.report.id}`} className="btn-success mt-3 w-full text-base">Pay <Peso v={due.remaining} /></Link>
          )}
          <p className="pt-1 text-xs text-choco-500">Payments go to Scoop Master&apos;s share first, then to your supply invoices (oldest first).</p>
        </div>
      )}
    </Card>
  );
}
