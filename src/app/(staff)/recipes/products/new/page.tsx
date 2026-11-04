import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { ProductForm } from "../../forms";

export const metadata = { title: "New product" };
export default async function Page() {
  await requirePage("recipes:write");
  const [items, recipes] = await Promise.all([prisma.inventoryItem.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }), prisma.recipe.findMany({ where: { isActive: true }, orderBy: { name: "asc" } })]);
  return <div className="max-w-4xl"><PageHeader title="New product" back={{ href: "/recipes/products", label: "Products" }} /><Card><ProductForm items={items} recipes={recipes} /></Card></div>;
}
