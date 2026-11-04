import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { MachineForm } from "../../machine-form";
import { updateMachineAction } from "../../actions";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("machines:write");
  const m = await prisma.machine.findUnique({ where: { id: (await params).id } });
  if (!m) notFound();
  return <div className="max-w-4xl"><PageHeader title={`Edit ${m.code}`} back={{ href: `/machines/${m.id}`, label: m.code }} /><Card><MachineForm action={updateMachineAction} m={m} /></Card></div>;
}
