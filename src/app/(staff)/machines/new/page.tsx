import { requirePage } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { MachineForm } from "../machine-form";
import { createMachineAction } from "../actions";

export const metadata = { title: "New machine" };
export default async function Page() {
  await requirePage("machines:write");
  return <div className="max-w-4xl"><PageHeader title="Add machine" back={{ href: "/machines", label: "Machines" }} subtitle="A unique machine ID is assigned automatically." /><Card><MachineForm action={createMachineAction} /></Card></div>;
}
