import { requirePartner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton, TextArea } from "@/components/forms";
import { SupplyLineInputs } from "@/components/supply-lines";
import { partnerSupplyRequestAction } from "../../actions";

export const metadata = { title: "Request supplies" };
export default async function Page() {
  await requirePartner();
  const items = await prisma.inventoryItem.findMany({ where: { isActive: true, isSellable: true }, orderBy: [{ category: "asc" }, { name: "asc" }] });
  return (
    <div>
      <PageHeader title="Request supplies" back={{ href: "/portal/supply-requests", label: "Supply requests" }} subtitle="Prices shown are your supply prices. Scoop Master will confirm quantities." />
      <Card>
        <ActionForm action={partnerSupplyRequestAction}>
          <SupplyLineInputs items={items} rows={6} />
          <TextArea label="Notes" name="notes" rows={2} />
          <SubmitButton>Send request</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
