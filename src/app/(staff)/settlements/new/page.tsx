import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { one, type SP } from "@/lib/params";
import { suggestNextPeriod } from "@/server/services/settlements";
import { Card, FilterBar, FilterField, PageHeader, humanize } from "@/components/ui";
import { ActionForm, DateField, SubmitButton, TextArea } from "@/components/forms";
import { createSettlementAction } from "../actions";

export const metadata = { title: "New settlement" };
export default async function NewSettlement({ searchParams }: { searchParams: SP }) {
  await requirePage("settlements:prepare");
  const partnerId = one((await searchParams).partnerId);
  const partners = await prisma.partner.findMany({ where: { contracts: { some: {} } }, orderBy: { businessName: "asc" } });
  const suggestion = partnerId ? await suggestNextPeriod(partnerId) : null;
  return (
    <div className="max-w-2xl">
      <PageHeader title="New settlement" back={{ href: "/settlements", label: "Settlements" }} subtitle="Pulls approved sales, ledger supply consumption and approved expenses for the period. Nothing is entered by hand." />
      <FilterBar>
        <FilterField label="Partner"><select className="input" name="partnerId" defaultValue={partnerId ?? ""}><option value="">Select…</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.businessName}</option>)}</select></FilterField>
      </FilterBar>
      {suggestion && partnerId && (
        <Card title={`Period (${humanize(suggestion.frequency)} schedule)`}>
          <ActionForm action={createSettlementAction}>
            <input type="hidden" name="partnerId" value={partnerId} />
            <div className="grid grid-cols-2 gap-3">
              <DateField label="Period start" name="periodStart" required defaultValue={fmtDate(suggestion.start)} />
              <DateField label="Period end" name="periodEnd" required defaultValue={fmtDate(suggestion.end)} />
            </div>
            <TextArea label="Notes" name="notes" rows={2} />
            <SubmitButton>Calculate draft</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
