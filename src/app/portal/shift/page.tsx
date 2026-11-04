import Link from "next/link";
import { requirePartner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatQty } from "@/lib/money";
import { fmtDate, fmtDateTime, todayDate } from "@/lib/dates";
import { UOM_LABEL } from "@/lib/units";
import { contractOn } from "@/server/services/partners";
import { openShiftFor, shiftOpeningData } from "@/server/services/shifts";
import { Alert, Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton, TextArea } from "@/components/forms";
import { partnerOpenShiftAction } from "../actions";

export const metadata = { title: "Open shift" };
export default async function OpenShiftPage() {
  const user = await requirePartner();
  const today = todayDate();
  const [contract, todayShift, earlier] = await Promise.all([
    contractOn(prisma, user.partnerId, today),
    prisma.shift.findUnique({ where: { partnerId_businessDate: { partnerId: user.partnerId, businessDate: today } } }),
    openShiftFor(prisma, user.partnerId, today),
  ]);
  if (contract?.reportingMethod !== "INVENTORY_COUNT") return <div><PageHeader title="Open shift" /><Alert>Your agreement uses unit-based sales reporting; shifts are not needed.</Alert></div>;
  if (earlier) return <div><PageHeader title="Open shift" /><Alert tone="berry">Your shift for {fmtDate(earlier.businessDate)} is still open. <Link className="link" href="/portal/sales/new">Submit its closing count</Link> first.</Alert></div>;
  if (todayShift) return <div><PageHeader title="Open shift" /><Alert tone="mint">Today&apos;s shift {todayShift.number} was opened at {fmtDateTime(todayShift.openedAt)}. {todayShift.status === "OPEN" && <Link className="link" href="/portal/sales/new">Close shift (closing count) →</Link>}</Alert></div>;
  const { rows, lastReport } = await shiftOpeningData(prisma, user.partnerId);
  return (
    <div className="space-y-4">
      <PageHeader title="Open shift" subtitle={fmtDate(today)} back={{ href: "/portal", label: "Home" }} />
      <p className="text-sm text-choco-600">
        {lastReport ? <>Carried over from your closing count on <b>{fmtDate(lastReport.reportDate)}</b> ({lastReport.number}), plus deliveries received since.</> : "Your starting stock from the supplies delivered to you."}
        {" "}Check your cups, cones and powder. If everything matches, just tap <b>Open shift</b>. If something is different, enter what you actually have.
      </p>
      <Card pad={false}>
        <ActionForm action={partnerOpenShiftAction} className="space-y-0">
          <ul className="divide-y divide-choco-50">{rows.map((r) => (
            <li key={r.item.id} className="grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] sm:items-center">
              <input type="hidden" name="itemId" value={r.item.id} />
              <div className="col-span-2 sm:col-span-1"><span className="font-medium">{r.item.name}</span><span className="block text-xs text-choco-500">{UOM_LABEL[r.item.uom]}</span></div>
              <div className="text-sm sm:text-right"><span className="label sm:hidden">Last closing</span><span className="tabular-nums">{r.lastClosing ? formatQty(r.lastClosing, 3) : <span className="text-xs text-choco-400">none yet</span>}</span></div>
              <div className="text-sm sm:text-right"><span className="label sm:hidden">Received since</span><span className="tabular-nums">{formatQty(r.receivedSince, 3)}</span></div>
              <div className="text-sm sm:text-right"><span className="label sm:hidden">You should have</span><span className="tabular-nums font-bold">{formatQty(r.carriedOver, 3)}</span></div>
              <label className="block"><span className="label">Actual (if different)</span><input className="input text-right" name={`count_${r.item.id}`} inputMode="decimal" placeholder="matches" /></label>
            </li>
          ))}</ul>
          <div className="space-y-3 p-4">
            <TextArea label="Notes (optional)" name="notes" rows={2} />
            <SubmitButton pendingText="Opening…">Open shift</SubmitButton>
            <p className="text-xs text-choco-500">Differences are recorded and Scoop Master is notified. Supplies you receive during the day are added automatically when you confirm the delivery.</p>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
