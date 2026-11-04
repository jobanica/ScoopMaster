import { requirePartner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDate, todayDate } from "@/lib/dates";
import { dateParam, one, type SP } from "@/lib/params";
import { contractOn } from "@/server/services/partners";
import { countFormProps, salesFormData } from "@/server/sales-form-data";
import { Alert, Empty, FilterBar, FilterField, PageHeader } from "@/components/ui";
import { SalesReportForm } from "@/components/sales-form";
import { CountReportForm } from "@/components/count-form";
import { partnerSaveCountAction, partnerSaveSalesAction } from "../../actions";

export const metadata = { title: "Submit sales" };
export default async function PortalNewSales({ searchParams }: { searchParams: SP }) {
  const user = await requirePartner();
  const sp = await searchParams;
  const reportId = one(sp.reportId);
  const existing = reportId ? await prisma.salesReport.findFirst({ where: { id: reportId, partnerId: user.partnerId } }) : null;
  const date = existing?.reportDate ?? dateParam(sp.date) ?? todayDate();
  const contract = await contractOn(prisma, user.partnerId, date);
  if (contract?.reportingMethod === "INVENTORY_COUNT") {
    const d = await countFormProps(user.partnerId, date);
    return (
      <div>
        <PageHeader title="Closing count" subtitle={fmtDate(date)} back={{ href: "/portal/sales", label: "My sales" }} />
        {!existing && <FilterBar><FilterField label="Date of count"><input className="input" name="date" defaultValue={fmtDate(date)} placeholder="DD/MM/YYYY" /></FilterField></FilterBar>}
        {d.report?.status === "REJECTED" && <Alert tone="berry">Returned for correction: {d.report.reviewNotes}</Alert>}
        {d.report && !["DRAFT", "REJECTED"].includes(d.report.status) ? <Alert tone="mint">The count for {fmtDate(date)} was already submitted ({d.report.number}).</Alert>
          : d.needsMapping.length ? <Alert tone="berry">Scoop Master still needs to set up pricing for {d.needsMapping.join(", ")}. Please contact them.</Alert>
          : <CountReportForm action={partnerSaveCountAction} rows={d.rows} consumption={d.consumption} ownerPct={d.ownerPct} reportDate={fmtDate(date)} initial={d.initial} audience="partner" />}
      </div>
    );
  }
  const data = await salesFormData(user.partnerId, reportId);
  return (
    <div>
      <PageHeader title={data.report ? `Edit ${data.report.number}` : "Daily sales report"} back={{ href: "/portal/sales", label: "My sales" }} />
      {data.report?.status === "REJECTED" && <Alert tone="berry">Returned for correction: {data.report.reviewNotes}</Alert>}
      {data.products.length === 0 ? <Empty>No products are set up yet. Please contact Scoop Master.</Empty> : <SalesReportForm action={partnerSaveSalesAction} products={data.products} machines={data.machines} items={data.items} initial={data.initial} />}
    </div>
  );
}
