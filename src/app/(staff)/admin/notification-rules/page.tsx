import type { NotificationType } from "@prisma/client";
import { requirePage } from "@/lib/auth";
import { ROLE_LABEL, STAFF_ROLES } from "@/lib/rbac";
import { getRule } from "@/server/services/notifications";
import { Card, PageHeader, humanize } from "@/components/ui";
import { ActionForm, Checkbox, SubmitButton } from "@/components/forms";
import { saveRuleAction } from "../actions";

export const metadata = { title: "Alert rules" };
const TYPES: { type: NotificationType; threshold?: string }[] = [
  { type: "MISSING_SALES_REPORT", threshold: "Days late before alerting" }, { type: "LOW_STOCK" }, { type: "EXPIRING_STOCK", threshold: "Days before expiry" },
  { type: "SUPPLY_REQUEST" }, { type: "PAYMENT_SUBMITTED" }, { type: "PAYMENT_OVERDUE" }, { type: "PAYMENT_DUE_SOON", threshold: "Days before due date" },
  { type: "MAINTENANCE_DUE", threshold: "Days before scheduled maintenance" }, { type: "MACHINE_PROBLEM" }, { type: "SALES_DROP", threshold: "% drop vs 7-day average" },
  { type: "CASH_DISCREPANCY", threshold: "Tolerance in pesos" }, { type: "SETTLEMENT_READY" }, { type: "CONTRACT_EXPIRING", threshold: "Days before contract end" }, { type: "EDIT_REQUEST" },
];

export default async function RulesPage() {
  await requirePage("notifications:manage");
  const rules = await Promise.all(TYPES.map(async (t) => ({ ...t, rule: await getRule(t.type) })));
  return (
    <div>
      <PageHeader title="Notification rules" subtitle="Choose who is alerted and the thresholds. Scheduled checks run via the cron endpoint or Notifications → Run alert checks now." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rules.map(({ type, threshold, rule }) => (
          <Card key={type} title={humanize(type)}>
            <ActionForm action={saveRuleAction} className="space-y-3">
              <input type="hidden" name="type" value={type} />
              <Checkbox label="Enabled" name="enabled" defaultChecked={rule.enabled} />
              <div><span className="label">Notify roles</span><div className="grid grid-cols-2 gap-1">{STAFF_ROLES.map((r) => <label key={r} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="roles" value={r} defaultChecked={rule.roles.includes(r)} className="accent-choco-700" />{ROLE_LABEL[r]}</label>)}</div></div>
              <Checkbox label="Also notify the partner" name="notifyPartner" defaultChecked={rule.notifyPartner} />
              {threshold && <label className="block"><span className="label">{threshold}</span><input className="input" name="threshold" defaultValue={String(rule.threshold)} /></label>}
              <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
            </ActionForm>
          </Card>
        ))}
      </div>
    </div>
  );
}
