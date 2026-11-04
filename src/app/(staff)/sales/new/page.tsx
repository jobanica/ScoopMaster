import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { one, type SP } from "@/lib/params";
import { salesFormData } from "@/server/sales-form-data";
import { Card, Empty, FilterBar, FilterField, PageHeader } from "@/components/ui";
import { SalesReportForm } from "@/components/sales-form";
import { staffSaveSalesAction } from "../actions";

export const metadata = { title: "Manual sales entry" };

export default async function NewSales({ searchParams }: { searchParams: SP }) {
  await requirePage("sales:write");
  const sp = await searchParams;
  const partnerId = one(sp.partnerId);
  const reportId = one(sp.reportId);
  const partners = await prisma.partner.findMany({ where: { status: { in: ["ACTIVE", "ON_HOLD"] } }, orderBy: { businessName: "asc" } });
  const data = partnerId ? await salesFormData(partnerId, reportId) : null;
  return (
    <div className="max-w-5xl">
      <PageHeader title={reportId ? "Edit sales report" : "Manual sales entry"} back={{ href: "/sales", label: "Sales reports" }} subtitle="Use when a partner reports by phone or paper. POS imports will use the same validation." />
      {!reportId && (
        <FilterBar>
          <FilterField label="Partner"><select className="input" name="partnerId" defaultValue={partnerId ?? ""} required><option value="">Select partner…</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.businessName} ({p.code})</option>)}</select></FilterField>
        </FilterBar>
      )}
      {!data ? <Empty>Select a partner to load their products and prices.</Empty> : data.products.length === 0 ? <Empty>No active products configured.</Empty> : (
        <Card><SalesReportForm action={staffSaveSalesAction} partnerId={partnerId} products={data.products} machines={data.machines} items={data.items} initial={data.initial} /></Card>
      )}
    </div>
  );
}
