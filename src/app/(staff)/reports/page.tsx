import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { REPORTS } from "@/server/reports";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Reports" };
export default async function ReportsPage() {
  const user = await requirePage("reports:view");
  const available = REPORTS.filter((r) => can(user.role, r.permission));
  const groups = [...new Set(available.map((r) => r.group))];
  return (
    <div>
      <PageHeader title="Reports & analytics" subtitle="Every report can be exported to PDF, Excel or CSV. All amounts in Philippine pesos." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <Card key={g} title={g}>
            <ul className="space-y-3">{available.filter((r) => r.group === g).map((r) => (
              <li key={r.key}><Link className="link" href={`/reports/${r.key}`}>{r.title}</Link><p className="text-xs text-choco-500">{r.description}</p></li>
            ))}</ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
