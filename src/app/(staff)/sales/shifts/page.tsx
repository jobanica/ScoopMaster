import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { D, formatQty } from "@/lib/money";
import { fmtDate, fmtDateTime, todayDate } from "@/lib/dates";
import { dateParam, type SP } from "@/lib/params";
import { shiftBoard } from "@/server/services/shifts";
import { Badge, Card, Empty, FilterBar, FilterField, PageHeader, Peso, Stat, StatusBadge } from "@/components/ui";

export const metadata = { title: "Shifts" };
export default async function ShiftsPage({ searchParams }: { searchParams: SP }) {
  await requirePage("sales:read");
  const date = dateParam((await searchParams).date) ?? todayDate();
  const board = await shiftBoard(date);
  const open = board.filter((b) => b.shift?.status === "OPEN").length;
  const closed = board.filter((b) => b.shift?.status === "CLOSED").length;
  const none = board.filter((b) => !b.shift && !b.report).length;
  const diffs = board.filter((b) => b.shift?.hasDiscrepancy).length;
  return (
    <div>
      <PageHeader title="Partner shifts" subtitle={`${fmtDate(date)} · partners on closing-count reporting`} back={{ href: "/sales", label: "Sales reports" }} />
      <FilterBar><FilterField label="Date"><input className="input" name="date" defaultValue={fmtDate(date)} placeholder="DD/MM/YYYY" /></FilterField></FilterBar>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open" value={open} tone="vanilla" />
        <Stat label="Closed" value={closed} tone="mint" />
        <Stat label="Not opened" value={none} tone={none ? "berry" : "mint"} />
        <Stat label="Opening differences" value={diffs} tone={diffs ? "berry" : "mint"} />
      </div>
      <Card pad={false}>
        {board.length === 0 ? <div className="p-5"><Empty>No partners use closing-count reporting on this date.</Empty></div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Partner</th><th>Shift</th><th>Opened</th><th>Closed</th><th>Opening differences</th><th className="num">Net sales</th><th className="num">Gross profit</th></tr></thead>
            <tbody>{board.map(({ partner, shift, report }) => (
              <tr key={partner.id}>
                <td><Link className="link" href={`/partners/${partner.id}?tab=sales`}>{partner.businessName}</Link></td>
                <td>{shift ? <><span className="font-mono text-xs">{shift.number}</span> <StatusBadge status={shift.status} /></> : report ? <Badge tone="vanilla">counted, no shift</Badge> : <Badge tone="berry">not opened</Badge>}</td>
                <td className="text-xs">{shift ? (shift.autoOpened ? "not opened (recorded at close)" : fmtDateTime(shift.openedAt)) : "—"}</td>
                <td className="text-xs">{shift?.closedAt ? fmtDateTime(shift.closedAt) : "—"}</td>
                <td className="text-xs">{shift?.lines.filter((l) => !D(l.variance).isZero()).map((l) => <div key={l.id} className="text-berry-700">{l.item.name}: {D(l.variance).isPositive() ? "+" : ""}{formatQty(l.variance, 3)} (had {formatQty(l.carriedOver, 3)}){l.treatedAsSold ? " · counted as sold" : " · written off"}</div>) ?? null}{shift && !shift.hasDiscrepancy && !shift.autoOpened && <span className="text-mint-700">matched</span>}</td>
                <td className="num">{report ? <Link className="link" href={`/sales/${report.id}`}><Peso v={report.netSales} /></Link> : "—"}</td>
                <td className="num">{report ? <Peso v={report.estimatedProfit} /> : "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
