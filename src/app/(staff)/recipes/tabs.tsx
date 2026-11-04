import { Tabs } from "@/components/ui";
export function RecipeTabs({ active }: { active: string }) {
  return <Tabs active={active} tabs={[{ key: "recipes", label: "Recipes & mix costing", href: "/recipes" }, { key: "products", label: "Products & serving costs", href: "/recipes/products" }]} />;
}
