import Link from "next/link";
import { requirePartner } from "@/lib/auth";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "More" };
const LINKS = [
  ["/portal/invoices", "Invoices & payments", "View supply invoices and submit proof of payment"],
  ["/portal/statements", "Profit-sharing statements", "Settlement statements and downloads"],
  ["/portal/expenses", "Operating expenses", "Submit expenses for approval"],
  ["/portal/machine", "My machine", "Machine details and report a problem"],
  ["/portal/agreement", "Partnership agreement", "Your contract terms and documents"],
  ["/portal/notifications", "Notifications", "Alerts and updates"],
];
export default async function MorePage() {
  await requirePartner();
  return (
    <div>
      <PageHeader title="More" />
      <ul className="divide-y divide-choco-50 rounded-2xl border border-choco-100 bg-white">{LINKS.map(([href, label, desc]) => <li key={href}><Link href={href} className="block px-4 py-3 hover:bg-cream-50"><span className="font-semibold">{label}</span><span className="block text-xs text-choco-500">{desc}</span></Link></li>)}</ul>
    </div>
  );
}
