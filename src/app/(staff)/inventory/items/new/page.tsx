import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { ItemForm } from "../../item-form";

export const metadata = { title: "New item" };
export default async function Page() {
  await requirePage("inventory:items");
  const suppliers = await prisma.contact.findMany({ where: { type: "SUPPLIER", isActive: true }, orderBy: { name: "asc" } });
  return <div className="max-w-4xl"><PageHeader title="New inventory item" back={{ href: "/inventory/items", label: "Items" }} /><Card><ItemForm suppliers={suppliers} /></Card></div>;
}
