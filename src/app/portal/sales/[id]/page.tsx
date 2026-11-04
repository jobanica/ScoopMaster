import { notFound } from "next/navigation";
import { requirePartner } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { ConfirmAction } from "@/components/forms";
import { Attachments } from "@/components/attachments";
import { SalesReportView, loadSalesReport } from "@/components/sales-view";
import { partnerEditRequestAction } from "../../actions";

export default async function PortalSalesDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePartner();
  const r = await loadSalesReport((await params).id);
  if (!r || r.partnerId !== user.partnerId) notFound();
  const pending = r.editRequests.some((e) => e.status === "PENDING");
  return (
    <div>
      <PageHeader title={`Report ${r.number}`} back={{ href: "/portal/sales", label: "My sales" }} actions={["SUBMITTED", "APPROVED"].includes(r.status) && !pending && !r.settlementId &&
        <ConfirmAction action={partnerEditRequestAction} label="Request correction" title="Request to edit this report" description="Submitted reports are locked. Scoop Master will review your request." hidden={{ id: r.id }} reasonLabel="What needs to be corrected?" reasonRequired variant="secondary" />} />
      <SalesReportView r={r} showCost={false} audience="partner" />
      {r.editRequests.length > 0 && <Card title="Correction requests" className="mt-4">{r.editRequests.map((e) => <div key={e.id} className="mb-2 text-sm"><StatusBadge status={e.status} /> {e.reason} <span className="text-xs text-choco-500">{fmtDateTime(e.createdAt)}</span>{e.reviewNotes && <div className="text-xs text-choco-600">Reply: {e.reviewNotes}</div>}</div>)}</Card>}
      <div className="mt-4"><Attachments entityType="SalesReport" entityId={r.id} back={`/portal/sales/${r.id}`} categories={["PHOTO", "RECEIPT"]} title="Photos" /></div>
    </div>
  );
}
