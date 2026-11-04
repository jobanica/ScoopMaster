import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { Card, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { ConfirmAction } from "@/components/forms";
import { Attachments } from "@/components/attachments";
import { SalesReportView, loadSalesReport } from "@/components/sales-view";
import { approveSalesAction, rejectSalesAction, reopenSalesAction, reviewEditAction } from "../actions";

export default async function SalesDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("sales:read");
  const r = await loadSalesReport((await params).id);
  if (!r) notFound();
  const review = can(user.role, "sales:review");
  const movements = await prisma.stockMovement.findMany({ where: { sourceType: "SalesReport", sourceId: r.id }, include: { item: true }, orderBy: { createdAt: "asc" } });
  return (
    <div>
      <PageHeader title={`Sales report ${r.number}`} back={{ href: "/sales", label: "Sales reports" }} subtitle={<Link className="link" href={`/partners/${r.partnerId}`}>{r.partner.businessName}</Link>} actions={<>
        {review && r.status === "SUBMITTED" && <>
          <ConfirmAction action={approveSalesAction} label="Approve" title="Approve this report?" description="Theoretical ingredient consumption and wastage will be posted to the partner's inventory ledger." hidden={{ id: r.id }} variant="success" reasonLabel="Review notes (optional)" />
          <ConfirmAction action={rejectSalesAction} label="Reject" title="Return report for correction" hidden={{ id: r.id }} variant="danger" reasonLabel="What needs correcting?" reasonRequired />
        </>}
        {review && ["SUBMITTED", "APPROVED"].includes(r.status) && <ConfirmAction action={reopenSalesAction} label="Reopen" title="Reopen report?" description="Ledger postings are reversed and the report returns to draft. This is recorded in the audit log." hidden={{ id: r.id }} variant="secondary" reasonLabel="Reason" reasonRequired />}
        {can(user.role, "sales:write") && ["DRAFT", "REJECTED"].includes(r.status) && <LinkButton href={`/sales/new?partnerId=${r.partnerId}&reportId=${r.id}`} variant="secondary">Edit</LinkButton>}
      </>} />
      <SalesReportView r={r} showCost />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Edit requests">
          {r.editRequests.length === 0 ? <p className="text-sm text-choco-500">None.</p> : r.editRequests.map((e) => (
            <div key={e.id} className="mb-3 rounded-lg border border-choco-50 p-3 text-sm">
              <div className="flex justify-between"><StatusBadge status={e.status} /><span className="text-xs text-choco-500">{fmtDateTime(e.createdAt)}</span></div>
              <p className="mt-1">{e.reason}</p>
              {e.reviewNotes && <p className="text-xs text-choco-500">Review: {e.reviewNotes}</p>}
              {review && e.status === "PENDING" && (
                <div className="mt-2 flex gap-2">
                  <ConfirmAction action={reviewEditAction} label="Approve edit" size="sm" variant="success" title="Approve edit request?" description="The report will be reopened so the partner can correct and resubmit it." hidden={{ id: r.id, requestId: e.id, decision: "approve" }} reasonLabel="Notes" />
                  <ConfirmAction action={reviewEditAction} label="Decline" size="sm" variant="secondary" title="Decline edit request?" hidden={{ id: r.id, requestId: e.id, decision: "reject" }} reasonLabel="Reason" reasonRequired />
                </div>
              )}
            </div>
          ))}
        </Card>
        <Attachments entityType="SalesReport" entityId={r.id} back={`/sales/${r.id}`} categories={["PHOTO", "RECEIPT", "GENERAL"]} title="Photos & attachments" />
      </div>
      {movements.length > 0 && (
        <Card title="Inventory postings from this report" className="mt-4" pad={false}>
          <table className="tbl"><thead><tr><th>Movement</th><th>Type</th><th>Item</th><th className="num">Qty</th></tr></thead>
            <tbody>{movements.map((m) => <tr key={m.id}><td className="font-mono text-xs">{m.number}</td><td><StatusBadge status={m.type} /></td><td>{m.item.name}</td><td className="num">{m.quantity.toString()}</td></tr>)}</tbody></table>
        </Card>
      )}
    </div>
  );
}
