import { notFound, redirect } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { one, rangeParams, type SP } from "@/lib/params";
import { formatCell, getReport, totalsFor } from "@/server/reports";
import { Card, Empty, FilterBar, FilterField, PageHeader } from "@/components/ui";

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: SP }) {
  const user = await requirePage("reports:view");
  const def = getReport((await params).key);
  if (!def) notFound();
  if (!can(user.role, def.permission)) redirect("/reports");
  const sp = await searchParams;
  const r = rangeParams(sp);
  const partnerId = def.usesPartner ? one(sp.partnerId) : undefined;
  const [result, partners] = await Promise.all([def.run({ from: r.from, to: r.to, partnerId }), def.usesPartner ? prisma.partner.findMany({ orderBy: { businessName: "asc" }, select: { id: true, businessName: true } }) : []]);
  const totals = totalsFor(result);
  const qs = new URLSearchParams({ from: r.fromText, to: r.toText, ...(partnerId ? { partnerId } : {}) }).toString();
  const right = (t: string) => ["money", "qty", "int", "pct"].includes(t);
  return (
    <div>
      <PageHeader title={def.title} subtitle={def.description} back={{ href: "/reports", label: "Reports" }} actions={<>
        <a className="btn-secondary" href={`/api/reports/${def.key}?${qs}&format=pdf`}>PDF</a>
        <a className="btn-secondary" href={`/api/reports/${def.key}?${qs}&format=xlsx`}>Excel</a>
        <a className="btn-secondary" href={`/api/reports/${def.key}?${qs}&format=csv`}>CSV</a>
      </>} />
      {(def.usesRange || def.usesPartner) && (
        <FilterBar>
          {def.usesRange && <><FilterField label="From"><input className="input" name="from" defaultValue={r.fromText} /></FilterField><FilterField label="To"><input className="input" name="to" defaultValue={r.toText} /></FilterField></>}
          {def.usesPartner && <FilterField label="Partner"><select className="input" name="partnerId" defaultValue={partnerId ?? ""}><option value="">All partners</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.businessName}</option>)}</select></FilterField>}
        </FilterBar>
      )}
      <Card pad={false}>
        {result.rows.length === 0 ? <div className="p-5"><Empty>No data for this period.</Empty></div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr>{result.columns.map((c) => <th key={c.key} className={right(c.type) ? "num" : ""}>{c.label}</th>)}</tr></thead>
            <tbody>{result.rows.map((row, i) => (
              <tr key={i} className={typeof row.line === "string" && /^[A-Z ]+$/.test(String(row.line).split(" (")[0]) ? "bg-cream-100 font-bold" : ""}>
                {result.columns.map((c) => { const s = formatCell(row[c.key], c.type); return <td key={c.key} className={`${right(c.type) ? "num" : ""} ${s.startsWith("-") && c.type === "money" ? "text-berry-700" : ""}`}>{s}</td>; })}
              </tr>
            ))}</tbody>
            {totals && <tfoot><tr className="bg-cream-200 font-bold">{result.columns.map((c, i) => <td key={c.key} className={right(c.type) ? "num" : ""}>{i === 0 ? "TOTAL" : c.key in totals ? formatCell(totals[c.key], c.type) : ""}</td>)}</tr></tfoot>}
          </table></div>
        )}
      </Card>
      {result.notes?.map((n, i) => <p key={i} className="mt-2 text-xs text-choco-500">{n}</p>)}
    </div>
  );
}
