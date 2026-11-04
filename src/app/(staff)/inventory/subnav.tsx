import { Tabs } from "@/components/ui";
export function InventoryTabs({ active }: { active: string }) {
  return <Tabs active={active} tabs={[
    { key: "stock", label: "Stock on hand", href: "/inventory" },
    { key: "items", label: "Items", href: "/inventory/items" },
    { key: "operations", label: "Stock operations", href: "/inventory/operations" },
    { key: "movements", label: "Movement history", href: "/inventory/movements" },
    { key: "counts", label: "Physical counts", href: "/inventory/counts" },
  ]} />;
}
