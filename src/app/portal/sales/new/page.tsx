import { requirePartner } from "@/lib/auth";
import { one, type SP } from "@/lib/params";
import { salesFormData } from "@/server/sales-form-data";
import { Alert, Empty, PageHeader } from "@/components/ui";
import { SalesReportForm } from "@/components/sales-form";
import { partnerSaveSalesAction } from "../../actions";

export const metadata = { title: "Submit sales" };
export default async function PortalNewSales({ searchParams }: { searchParams: SP }) {
  const user = await requirePartner();
  const data = await salesFormData(user.partnerId, one((await searchParams).reportId));
  return (
    <div>
      <PageHeader title={data.report ? `Edit ${data.report.number}` : "Daily sales report"} back={{ href: "/portal/sales", label: "My sales" }} />
      {data.report?.status === "REJECTED" && <Alert tone="berry">Returned for correction: {data.report.reviewNotes}</Alert>}
      {data.products.length === 0 ? <Empty>No products are set up yet. Please contact Scoop Master.</Empty> : <SalesReportForm action={partnerSaveSalesAction} products={data.products} machines={data.machines} items={data.items} initial={data.initial} />}
    </div>
  );
}
