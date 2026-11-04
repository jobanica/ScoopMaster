import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, todayDate } from "@/lib/dates";
import { Card, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { ActionForm, DateField, SelectField, SubmitButton, TextArea } from "@/components/forms";
import { InventoryTabs } from "../subnav";
import { createCountAction } from "../actions";

export const metadata = { title: "Physical counts" };
export default async function CountsPage() {
  const user = await requirePage("inventory:read");
  const [counts, locations] = await Promise.all([
    prisma.stockCount.findMany({ include: { location: true, _count: { select: { lines: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.location.findMany({ where: { isActive: true, type: { not: "IN_TRANSIT" } }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
  ]);
  return (
    <div>
      <PageHeader title="Inventory" />
      <InventoryTabs active="counts" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Counts" className="lg:col-span-2" pad={false}>
          {counts.length === 0 ? <div className="p-5"><Empty>No physical counts yet.</Empty></div> : (
            <table className="tbl"><thead><tr><th>Count</th><th>Location</th><th>Date</th><th>Status</th><th className="num">Items</th></tr></thead>
              <tbody>{counts.map((c) => <tr key={c.id}><td><Link className="link" href={`/inventory/counts/${c.id}`}>{c.number}</Link></td><td>{c.location.name}</td><td>{fmtDate(c.countDate)}</td><td><StatusBadge status={c.status} /></td><td className="num">{c._count.lines}</td></tr>)}</tbody></table>
          )}
        </Card>
        {can(user.role, "inventory:write") && (
          <Card title="Start a physical count">
            <ActionForm action={createCountAction}>
              <SelectField label="Location" name="locationId" required placeholder="Select…" options={locations.map((l) => ({ value: l.id, label: l.name }))} />
              <DateField label="Count date" name="countDate" required defaultValue={fmtDate(todayDate())} />
              <TextArea label="Notes" name="notes" rows={2} />
              <SubmitButton>Start count</SubmitButton>
            </ActionForm>
            <p className="mt-2 text-xs text-choco-500">System quantities are snapshotted. Posting records variances as COUNT_VARIANCE movements against the live balance.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
