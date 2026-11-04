import { notFound } from "next/navigation";
import { requirePartner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/forms";
import { SettlementStatement } from "@/components/settlement-statement";

export default async function PortalStatement({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePartner();
  const s = await prisma.settlement.findUnique({ where: { id: (await params).id }, include: { partner: true, contract: true } });
  if (!s || s.partnerId !== user.partnerId || s.status !== "FINALIZED") notFound();
  return (
    <div>
      <PageHeader title={`Statement ${s.number}`} back={{ href: "/portal/statements", label: "Statements" }} actions={<><PrintButton /><a className="btn-secondary" href={`/api/pdf/settlement/${s.id}`}>Download PDF</a></>} />
      <SettlementStatement s={s} audience="partner" />
    </div>
  );
}
