import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, SelectField, SubmitButton, TextArea } from "@/components/forms";
import { SupplyLineInputs } from "@/components/supply-lines";
import { createSupplyOrderAction } from "../actions";

export const metadata = { title: "New supply order" };
export default async function Page() {
  await requirePage("supply:review");
  const [partners, items] = await Promise.all([
    prisma.partner.findMany({ where: { status: { in: ["ACTIVE", "PENDING_APPROVAL", "ON_HOLD"] } }, orderBy: { businessName: "asc" } }),
    prisma.inventoryItem.findMany({ where: { isActive: true, isSellable: true }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="New supply order" back={{ href: "/supply-orders", label: "Supply orders" }} subtitle="Use for initial supplies or orders placed by phone. It follows the same approval flow." />
      <Card>
        <ActionForm action={createSupplyOrderAction}>
          <SelectField label="Partner" name="partnerId" required placeholder="Select partner…" options={partners.map((p) => ({ value: p.id, label: `${p.businessName} (${p.code})` }))} />
          <SupplyLineInputs items={items} />
          <TextArea label="Notes" name="notes" rows={2} />
          <SubmitButton>Create order</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
