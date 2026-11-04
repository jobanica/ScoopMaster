import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Alert, PageHeader } from "@/components/ui";
import { ConfirmAction, PrintButton } from "@/components/forms";
import { SettlementStatement } from "@/components/settlement-statement";
import { gatherSettlementData } from "@/server/services/settlements";
import { finalizeAction, recalcAction, returnAction, submitAction, voidAction } from "../actions";

export default async function SettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("settlements:read");
  const s = await prisma.settlement.findUnique({ where: { id: (await params).id }, include: { partner: true, contract: true, invoice: true, bill: true } });
  if (!s) notFound();
  const pending = s.status === "DRAFT" ? await gatherSettlementData(prisma, s.partnerId, s.periodStart, s.periodEnd, s.id).catch(() => null) : null;
  const users = await prisma.user.findMany({ where: { id: { in: [s.preparedById, s.approvedById].filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? "—";
  const canApprove = can(user.role, "settlements:approve") && (s.preparedById !== user.id || user.role === "SUPER_ADMIN");
  return (
    <div>
      <PageHeader title={`Settlement ${s.number}`} back={{ href: "/settlements", label: "Settlements" }} subtitle={<span>Prepared by {name(s.preparedById)}{s.approvedById && ` · approved by ${name(s.approvedById)}`} · <Link className="link" href={`/partners/${s.partnerId}?tab=settlements`}>{s.partner.businessName}</Link></span>} actions={<>
        <PrintButton label="Print statement" />
        <a className="btn-secondary" href={`/api/pdf/settlement/${s.id}`}>Download PDF</a>
        {s.status === "DRAFT" && can(user.role, "settlements:prepare") && <>
          <ConfirmAction action={recalcAction} label="Recalculate" title="Recalculate from current data?" hidden={{ id: s.id }} variant="secondary" />
          <ConfirmAction action={submitAction} label="Submit for approval" title="Submit for approval?" description="The figures are recalculated and the period is locked: sales, expenses and stock movements in this period can no longer change." hidden={{ id: s.id }} />
        </>}
        {s.status === "PENDING_APPROVAL" && can(user.role, "settlements:approve") && <>
          {canApprove && <ConfirmAction action={finalizeAction} label="Approve & finalize" title="Finalize settlement?" description={`This records ${s.netDueToOwner.isNeg() ? "a payable to the partner" : "a receivable from the partner"} and sends the statement to the partner portal.`} hidden={{ id: s.id }} variant="success" />}
          <ConfirmAction action={returnAction} label="Return to draft" title="Return to preparer?" hidden={{ id: s.id }} variant="secondary" reasonLabel="What needs to change?" reasonRequired />
        </>}
        {s.status !== "VOIDED" && can(user.role, s.status === "FINALIZED" ? "settlements:approve" : "settlements:prepare") && <ConfirmAction action={voidAction} label="Void" title="Void settlement?" description="Unlocks the period and releases the included reports/expenses. The generated invoice or bill is cancelled (it must have no payments)." hidden={{ id: s.id }} variant="danger" reasonLabel="Reason" reasonRequired />}
      </>} />
      {s.status === "PENDING_APPROVAL" && !canApprove && can(user.role, "settlements:approve") && <Alert>You prepared this settlement, so another authorized approver must finalize it.</Alert>}
      {s.status === "VOIDED" && <Alert tone="gray">Voided: {s.voidReason}</Alert>}
      {pending && (pending.pendingReports > 0 || pending.pendingExpenses > 0) && <Alert>{pending.pendingReports} sales report(s) and {pending.pendingExpenses} expense(s) in this period are still awaiting review. They must be resolved before submission.</Alert>}
      {s.invoice && <Alert tone="mint">Receivable created: <Link className="link" href={`/finance/invoices/${s.invoice.id}`}>{s.invoice.number}</Link> ({s.invoice.status.toLowerCase().replace("_", " ")})</Alert>}
      {s.bill && <Alert tone="sky">Payable to partner created: <Link className="link" href={`/finance/bills/${s.bill.id}`}>{s.bill.number}</Link> ({s.bill.status.toLowerCase().replace("_", " ")})</Alert>}
      <SettlementStatement s={s} audience="owner" />
    </div>
  );
}
