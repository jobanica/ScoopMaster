import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { RecipeForm } from "../forms";

export const metadata = { title: "New recipe" };
export default async function Page() {
  await requirePage("recipes:write");
  const items = await prisma.inventoryItem.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  return <div className="max-w-5xl"><PageHeader title="New recipe" back={{ href: "/recipes", label: "Recipes" }} /><Card><RecipeForm items={items} /></Card></div>;
}
