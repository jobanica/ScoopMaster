import { requirePartner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { Card, DL, Empty, PageHeader, StatusBadge, humanize } from "@/components/ui";
import { ActionForm, SubmitButton, TextArea } from "@/components/forms";
import { partnerProblemAction } from "../actions";

export const metadata = { title: "My machine" };
export default async function PortalMachine() {
  const user = await requirePartner();
  const machines = await prisma.machine.findMany({ where: { currentPartnerId: user.partnerId }, include: { maintenance: { where: { partnerId: user.partnerId }, orderBy: { reportedAt: "desc" }, take: 20 } } });
  if (!machines.length) return <div><PageHeader title="My machine" /><Empty>No machine is assigned to you.</Empty></div>;
  return (
    <div className="space-y-4">
      <PageHeader title="My machine" />
      {machines.map((m) => (
        <div key={m.id} className="space-y-4">
          <Card title={`${m.code} · ${m.brand} ${m.model}`}>
            <DL items={[["Serial number", m.serialNumber], ["Nozzles", m.nozzles], ["Status", <StatusBadge key="s" status={m.status} />], ["Deployed since", fmtDate(m.deployedAt)], ["Next maintenance", fmtDate(m.nextMaintenanceDate)], ["Condition", humanize(m.condition)]]} />
          </Card>
          <Card title="Report a problem">
            <ActionForm action={partnerProblemAction} resetOnSuccess>
              <input type="hidden" name="machineId" value={m.id} />
              <TextArea label="What is happening?" name="description" required placeholder="e.g. Left nozzle leaking, mix too soft, error code E2…" />
              <SubmitButton>Send report</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Service history" pad={false}>
            {m.maintenance.length === 0 ? <div className="p-5"><Empty /></div> : <ul className="divide-y divide-choco-50">{m.maintenance.map((r) => <li key={r.id} className="px-4 py-3 text-sm"><div className="flex justify-between"><span className="font-semibold">{r.number}</span><StatusBadge status={r.status} /></div><p>{r.description}</p>{r.resolution && <p className="text-mint-700">{r.resolution}</p>}<p className="text-xs text-choco-500">{fmtDateTime(r.reportedAt)}</p></li>)}</ul>}
          </Card>
        </div>
      ))}
    </div>
  );
}
