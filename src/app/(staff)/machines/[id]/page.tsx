import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { formatPHP } from "@/lib/money";
import { fmtDate, fmtDateTime, todayDate } from "@/lib/dates";
import { machineProfitability } from "@/server/services/machines";
import { Badge, Card, DL, Empty, LinkButton, PageHeader, Peso, Stat, StatusBadge, humanize } from "@/components/ui";
import { ActionForm, Checkbox, ConfirmAction, DateField, Field, SelectField, SubmitButton, TextArea } from "@/components/forms";
import { Attachments } from "@/components/attachments";
import { assignMachineAction, createMaintenanceAction, machineStatusAction, returnMachineAction, updateMaintenanceAction } from "../actions";

export default async function MachineDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("machines:read");
  const { id } = await params;
  const m = await prisma.machine.findUnique({
    where: { id },
    include: {
      currentPartner: true,
      assignments: { include: { partner: true }, orderBy: { startDate: "desc" } },
      maintenance: { include: { technician: true, bill: true, partner: true }, orderBy: { reportedAt: "desc" } },
    },
  });
  if (!m) notFound();
  const [prof] = await machineProfitability(id);
  const partners = await prisma.partner.findMany({ where: { status: { in: ["ACTIVE", "PENDING_APPROVAL"] }, NOT: { id: m.currentPartnerId ?? "" } }, orderBy: { businessName: "asc" } });
  const techs = await prisma.contact.findMany({ where: { type: "TECHNICIAN", isActive: true }, orderBy: { name: "asc" } });
  const write = can(user.role, "machines:write");
  const fin = can(user.role, "dashboard:financials");
  const today = fmtDate(todayDate());
  const conditionOpts = ["NEW", "GOOD", "FAIR", "POOR", "DEFECTIVE"].map((c) => ({ value: c, label: humanize(c) }));

  return (
    <div>
      <PageHeader
        title={`${m.code} · ${m.brand} ${m.model}`}
        back={{ href: "/machines", label: "Machines" }}
        subtitle={<span className="flex items-center gap-2"><StatusBadge status={m.status} /> {m.currentPartner && <>at <Link className="link" href={`/partners/${m.currentPartner.id}`}>{m.currentPartner.businessName}</Link></>}</span>}
        actions={write && <>
          <LinkButton href={`/machines/${m.id}/edit`} variant="secondary">Edit</LinkButton>
          {m.status !== "SOLD" && (
            <ConfirmAction action={machineStatusAction} label="Change status" title="Change machine status" hidden={{ machineId: m.id }} reasonLabel="Reason" reasonRequired variant="secondary">
              <SelectField label="New status" name="status" options={["AVAILABLE", "RESERVED", "UNDER_MAINTENANCE", "RETURNED", "SOLD"].map((s) => ({ value: s, label: humanize(s) }))} />
            </ConfirmAction>
          )}
        </>}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total sales generated" value={formatPHP(prof.totalSales)} hint={`${prof.totalUnits} units`} tone="berry" />
        <Stat label="Supplies consumed (est.)" value={formatPHP(prof.suppliesConsumed)} />
        {fin && <Stat label="My partnership income" value={formatPHP(prof.partnershipIncome)} hint="Attributed from finalized settlements" tone="mint" />}
        <Stat label="Maintenance expenses" value={formatPHP(prof.maintenanceCost)} tone="vanilla" />
        {fin && <Stat label="ROI" value={`${prof.roiPct.toFixed(1)}%`} hint={`Payback remaining ${formatPHP(prof.paybackRemaining)}`} tone="sky" />}
        <Stat label="Utilization" value={`${prof.utilizationPct}%`} hint={`${prof.deployedDays} days deployed`} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Machine details" className="lg:col-span-2">
          <DL cols={3} items={[
            ["Brand", m.brand], ["Model", m.model], ["Type", m.machineType], ["Nozzles", m.nozzles], ["Serial number", m.serialNumber], ["Condition", humanize(m.condition)],
            ["Purchase date", fmtDate(m.purchaseDate)], ["Purchase price", <Peso key="p" v={m.purchasePrice} />], ["Warranty expires", m.warrantyExpiry ? <span key="w">{fmtDate(m.warrantyExpiry)} {m.warrantyExpiry < todayDate() && <Badge tone="gray">expired</Badge>}</span> : "—"],
            ["Deployed since", fmtDate(m.deployedAt)], ["Next maintenance", fmtDate(m.nextMaintenanceDate)], ["Notes", m.notes],
          ]} />
        </Card>
        {write && m.status !== "SOLD" && (
          <Card title={m.currentPartnerId ? "Transfer / return" : "Deploy to partner"}>
            <ActionForm action={assignMachineAction} resetOnSuccess>
              <input type="hidden" name="machineId" value={m.id} />
              <SelectField label={m.currentPartnerId ? "Transfer to partner" : "Partner"} name="partnerId" required placeholder="Select partner…" options={partners.map((p) => ({ value: p.id, label: `${p.businessName} (${p.code})` }))} />
              <DateField label="Effective date" name="date" required defaultValue={today} />
              <Field label="Reason" name="reason" required placeholder={m.currentPartnerId ? "e.g. Relocation to higher-traffic site" : "Initial deployment"} />
              <SubmitButton>{m.currentPartnerId ? "Transfer machine" : "Deploy machine"}</SubmitButton>
            </ActionForm>
            {m.currentPartnerId && (
              <div className="mt-4 border-t border-choco-50 pt-4">
                <ConfirmAction action={returnMachineAction} label="Return to warehouse" title="Return machine" hidden={{ machineId: m.id }} reasonLabel="Reason" reasonRequired variant="secondary">
                  <DateField label="Return date" name="date" required defaultValue={today} />
                  <SelectField label="Condition on return" name="condition" defaultValue={m.condition} options={conditionOpts} />
                </ConfirmAction>
              </div>
            )}
          </Card>
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Maintenance history" className="lg:col-span-2" pad={false}>
          {m.maintenance.length === 0 ? <div className="p-5"><Empty>No maintenance recorded.</Empty></div> : (
            <div className="divide-y divide-choco-50">
              {m.maintenance.map((r) => (
                <div key={r.id} className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><span className="font-mono text-xs">{r.number}</span><Badge tone="choco">{humanize(r.type)}</Badge><StatusBadge status={r.status} /></div>
                    <span className="text-xs text-choco-500">{fmtDateTime(r.reportedAt)}{r.partner && ` · ${r.partner.businessName}`}</span>
                  </div>
                  <p className="mt-2 text-sm">{r.description}</p>
                  {r.resolution && <p className="mt-1 text-sm text-mint-700">Resolution: {r.resolution}</p>}
                  <p className="mt-1 text-xs text-choco-500">Cost <Peso v={r.cost} />{r.technician && ` · ${r.technician.name}`}{r.bill && <> · bill <Link className="link" href={`/finance/bills/${r.bill.id}`}>{r.bill.number}</Link></>}</p>
                  {can(user.role, "maintenance:write") && !["RESOLVED", "CANCELLED"].includes(r.status) && (
                    <details className="mt-3 rounded-lg bg-cream-50 p-3">
                      <summary className="cursor-pointer text-sm font-semibold text-choco-700">Update record</summary>
                      <ActionForm action={updateMaintenanceAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                        <input type="hidden" name="id" value={r.id} /><input type="hidden" name="machineId" value={m.id} />
                        <SelectField label="Status" name="status" defaultValue={r.status} options={["OPEN", "IN_PROGRESS", "RESOLVED", "CANCELLED"].map((s) => ({ value: s, label: humanize(s) }))} />
                        <Field label="Repair cost (₱)" name="cost" defaultValue={r.cost.toString()} />
                        <SelectField label="Technician" name="technicianId" defaultValue={r.technicianId} placeholder="—" options={techs.map((t) => ({ value: t.id, label: t.name }))} />
                        <DateField label="Bill due date" name="billDueDate" defaultValue={today} />
                        <div className="sm:col-span-2"><TextArea label="Resolution / work done" name="resolution" defaultValue={r.resolution} rows={2} /></div>
                        <DateField label="Next maintenance date (on resolve)" name="nextMaintenanceDate" />
                        <div className="space-y-2 pt-5">
                          {!r.billId && <Checkbox label="Record cost as a payable (bill)" name="createBill" defaultChecked hint="Creates an expense in Accounts Payable" />}
                          <Checkbox label="Mark machine Under Maintenance" name="underMaintenance" />
                        </div>
                        <div className="sm:col-span-2"><SubmitButton>Update</SubmitButton></div>
                      </ActionForm>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
        <div className="space-y-4">
          {can(user.role, "maintenance:write") && (
            <Card title="Log maintenance / problem">
              <ActionForm action={createMaintenanceAction} resetOnSuccess>
                <input type="hidden" name="machineId" value={m.id} />
                <SelectField label="Type" name="type" defaultValue="REPAIR" options={["PREVENTIVE", "REPAIR", "INSPECTION", "PROBLEM_REPORT"].map((s) => ({ value: s, label: humanize(s) }))} />
                <TextArea label="Description" name="description" required />
                <SubmitButton>Create record</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <Card title="Deployment history (audit trail)" pad={false}>
            {m.assignments.length === 0 ? <div className="p-5"><Empty>Never deployed.</Empty></div> : (
              <ul className="divide-y divide-choco-50">{m.assignments.map((a) => (
                <li key={a.id} className="px-5 py-3 text-sm">
                  <Link className="link" href={`/partners/${a.partnerId}`}>{a.partner.businessName}</Link>
                  <div className="text-xs text-choco-500">{fmtDate(a.startDate)} – {a.endDate ? fmtDate(a.endDate) : "present"}</div>
                  {a.reason && <div className="text-xs text-choco-600">{a.reason}</div>}
                </li>
              ))}</ul>
            )}
          </Card>
          <Attachments entityType="Machine" entityId={m.id} back={`/machines/${m.id}`} categories={["PHOTO", "WARRANTY", "GENERAL"]} />
        </div>
      </div>
    </div>
  );
}
