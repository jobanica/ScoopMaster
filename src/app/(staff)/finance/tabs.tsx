import { Tabs } from "@/components/ui";
export function FinanceTabs({ active }: { active: string }) {
  return <Tabs active={active} tabs={[
    { key: "overview", label: "Overview", href: "/finance" },
    { key: "receivables", label: "Receivables", href: "/finance/receivables" },
    { key: "payables", label: "Payables & expenses", href: "/finance/payables" },
    { key: "payments", label: "Payments", href: "/finance/payments" },
    { key: "partner-expenses", label: "Partner expenses", href: "/finance/partner-expenses" },
    { key: "contacts", label: "Contacts", href: "/finance/contacts" },
  ]} />;
}
