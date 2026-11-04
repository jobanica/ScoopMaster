import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { PartnerForm } from "../../partner-form";
import { updatePartnerAction } from "../../actions";

export default async function EditPartnerPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("partners:write");
  const partner = await prisma.partner.findUnique({ where: { id: (await params).id } });
  if (!partner) notFound();
  return (
    <div className="max-w-3xl">
      <PageHeader title={`Edit ${partner.businessName}`} back={{ href: `/partners/${partner.id}`, label: partner.code }} />
      <Card><PartnerForm action={updatePartnerAction} partner={partner} /></Card>
    </div>
  );
}
