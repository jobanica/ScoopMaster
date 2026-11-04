import { requirePage } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { PartnerForm } from "../partner-form";
import { createPartnerAction } from "../actions";

export const metadata = { title: "New partner" };
export default async function NewPartnerPage() {
  await requirePage("partners:write");
  return (
    <div className="max-w-3xl">
      <PageHeader title="New partner" back={{ href: "/partners", label: "Partners" }} subtitle="A unique partner ID and an inventory location are created automatically." />
      <Card><PartnerForm action={createPartnerAction} /></Card>
    </div>
  );
}
