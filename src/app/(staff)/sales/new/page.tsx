import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDate, todayDate } from "@/lib/dates";
import { dateParam, one, type SP } from "@/lib/params";
import { contractOn } from "@/server/services/partners";
import { countFormProps, salesFormData } from "@/server/sales-form-data";
import { Alert, Card, Empty, FilterBar, FilterField, PageHeader } from "@/components/ui";
import { SalesReportForm } from "@/components/sales-form";
import { CountReportForm } from "@/components/count-form";
import { staffSaveCountAction, staffSaveSalesAction } from "../actions";

export const metadata = { title: "Manual sales entry" };

export default async function NewSales({ searchParams }: { searchParams: SP }) {
  await requirePage("sales:write");
  const sp = await searchParams;
  const partnerId = one(sp.partnerId);
  const reportId = one(sp.reportId);
  const partners = await prisma.partner.findMany({ where: { status: { in: ["ACTIVE", "ON_HOLD"] } }, orderBy: { businessName: "asc" } });
  const existing = reportId ? await prisma.salesReport.findUnique({ where: { id: reportId } }) : null;
  const date = existing?.reportDate ?? dateParam(sp.date) ?? todayDate();
  const contract = partnerId ? await contractOn(prisma, partnerId, date) : null;
  const countMode = contract?.reportingMethod === "INVENTORY_COUNT";
  const count = partnerId && countMode ? await countFormProps(partnerId, date) : null;
  const data = partnerId && !countMode ? await salesFormData(partnerId, reportId) : null;
  return (
    <div className="max-w-5xl">
      <PageHeader title={reportId ? "Edit sales report" : countMode ? "Closing count entry" : "Manual sales entry"} back={{ href: "/sales", label: "Sales reports" }} subtitle="Use when a partner reports by phone or paper. POS imports will use the same validation." />
      {!reportId && (
        <FilterBar>
          <FilterField label="Partner"><select className="input" name="partnerId" defaultValue={partnerId ?? ""} required><option value="">Select partner…</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.businessName} ({p.code})</option>)}</select></FilterField>
          <FilterField label="Date"><input className="input" name="date" defaultValue={fmtDate(date)} placeholder="DD/MM/YYYY" /></FilterField>
        </FilterBar>
      )}
      {!partnerId ? <Empty>Select a partner to load their products and prices.</Empty>
        : count ? (count.report && !["DRAFT", "REJECTED"].includes(count.report.status) ? <Alert tone="mint">A count for {fmtDate(date)} was already submitted ({count.report.number}).</Alert>
          : count.needsMapping.length ? <Alert tone="berry">Set which product {count.needsMapping.join(", ")} are sold as on the partner&apos;s Prices tab first.</Alert>
          : <Card><CountReportForm action={staffSaveCountAction} partnerId={partnerId} rows={count.rows} consumption={count.consumption} ownerPct={count.ownerPct} reportDate={fmtDate(date)} initial={count.initial} audience="staff" /></Card>)
        : !data || data.products.length === 0 ? <Empty>No active products configured.</Empty>
        : <Card><SalesReportForm action={staffSaveSalesAction} partnerId={partnerId} products={data.products} machines={data.machines} items={data.items} initial={data.initial} /></Card>}
    </div>
  );
}
