import Link from "next/link";
import { Search } from "lucide-react";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { one, type SP } from "@/lib/params";
import { Card, Empty, PageHeader, Peso, StatusBadge } from "@/components/ui";

export const metadata = { title: "Search" };
type Hit = { href: string; title: string; sub: string; status?: string; amount?: unknown };

export default async function SearchPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePage("dashboard:view");
  const q = (one((await searchParams).q) ?? "").trim().slice(0, 80);
  const groups: { label: string; hits: Hit[] }[] = [];
  if (q.length >= 2) {
    const ci = { contains: q, mode: "insensitive" as const };
    const take = 8;
    const run: Promise<void>[] = [];
    const add = (label: string, p: Promise<Hit[]>) => run.push(p.then((hits) => { if (hits.length) groups.push({ label, hits }); }));
    if (can(user.role, "partners:read")) add("Partners", prisma.partner.findMany({ where: { OR: [{ businessName: ci }, { ownerName: ci }, { code: ci }, { area: ci }] }, take }).then((r) => r.map((p) => ({ href: `/partners/${p.id}`, title: p.businessName, sub: `${p.code} · ${p.ownerName}${p.area ? ` · ${p.area}` : ""}`, status: p.status }))));
    if (can(user.role, "machines:read")) add("Machines", prisma.machine.findMany({ where: { OR: [{ code: ci }, { serialNumber: ci }, { brand: ci }, { model: ci }] }, take }).then((r) => r.map((m) => ({ href: `/machines/${m.id}`, title: `${m.code} · ${m.brand} ${m.model}`, sub: `Serial ${m.serialNumber}`, status: m.status }))));
    if (can(user.role, "sales:read")) add("Sales reports", prisma.salesReport.findMany({ where: { OR: [{ number: ci }, { partner: { businessName: ci } }] }, take, orderBy: { reportDate: "desc" }, include: { partner: true } }).then((r) => r.map((s) => ({ href: `/sales/${s.id}`, title: s.number, sub: `${s.partner.businessName} · ${fmtDate(s.reportDate)}`, status: s.status, amount: s.netSales }))));
    if (can(user.role, "finance:read")) {
      add("Invoices", prisma.invoice.findMany({ where: { OR: [{ number: ci }, { description: ci }, { partner: { businessName: ci } }] }, take, orderBy: { issueDate: "desc" }, include: { partner: true, contact: true } }).then((r) => r.map((i) => ({ href: `/finance/invoices/${i.id}`, title: i.number, sub: `${i.partner?.businessName ?? i.contact?.name ?? ""} · ${i.description}`, status: i.status, amount: i.amount }))));
      add("Bills", prisma.bill.findMany({ where: { OR: [{ number: ci }, { payeeName: ci }, { description: ci }] }, take, orderBy: { billDate: "desc" } }).then((r) => r.map((b) => ({ href: `/finance/bills/${b.id}`, title: b.number, sub: `${b.payeeName} · ${b.description}`, status: b.status, amount: b.amount }))));
      add("Payments", prisma.payment.findMany({ where: { OR: [{ number: ci }, { reference: ci }, { partyName: ci }] }, take, orderBy: { paymentDate: "desc" } }).then((r) => r.map((p) => ({ href: `/finance/payments/${p.id}`, title: p.number, sub: `${p.partyName} · ${fmtDate(p.paymentDate)}${p.reference ? ` · ref ${p.reference}` : ""}`, status: p.status, amount: p.amount }))));
    }
    if (can(user.role, "inventory:read")) add("Inventory items", prisma.inventoryItem.findMany({ where: { OR: [{ name: ci }, { sku: ci }] }, take }).then((r) => r.map((i) => ({ href: `/inventory/items/${i.id}`, title: i.name, sub: i.sku }))));
    if (can(user.role, "supply:read")) add("Supply orders", prisma.supplyOrder.findMany({ where: { OR: [{ number: ci }, { partner: { businessName: ci } }] }, take, orderBy: { requestedAt: "desc" }, include: { partner: true } }).then((r) => r.map((o) => ({ href: `/supply-orders/${o.id}`, title: o.number, sub: o.partner.businessName, status: o.status }))));
    if (can(user.role, "settlements:read")) add("Settlements", prisma.settlement.findMany({ where: { OR: [{ number: ci }, { partner: { businessName: ci } }] }, take, orderBy: { periodEnd: "desc" }, include: { partner: true } }).then((r) => r.map((s) => ({ href: `/settlements/${s.id}`, title: s.number, sub: `${s.partner.businessName} · ${fmtDate(s.periodStart)}–${fmtDate(s.periodEnd)}`, status: s.status, amount: s.ownerShare }))));
    await Promise.all(run);
  }
  const order = ["Partners", "Sales reports", "Invoices", "Payments", "Machines", "Supply orders", "Settlements", "Bills", "Inventory items"];
  groups.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  return (
    <div>
      <PageHeader title="Search" subtitle={q ? `Results for “${q}”` : "Find partners, machines, reports, invoices, payments and items"} />
      <form className="relative mb-5 max-w-xl">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-choco-300" />
        <input name="q" type="search" defaultValue={q} autoFocus placeholder="Type at least 2 characters…" className="input rounded-full pl-9" />
      </form>
      {q.length < 2 ? null : groups.length === 0 ? <Empty>No matches for “{q}”.</Empty> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.label} title={g.label} pad={false}>
              <ul className="divide-y divide-choco-50">{g.hits.map((h) => (
                <li key={h.href}><Link href={h.href} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-cream-50">
                  <span className="min-w-0"><span className="block truncate font-medium text-choco-900">{h.title}</span><span className="block truncate text-xs text-choco-500">{h.sub}</span></span>
                  <span className="flex shrink-0 flex-col items-end gap-1">{h.amount !== undefined && <Peso v={h.amount as never} className="text-sm" />}{h.status && <StatusBadge status={h.status} />}</span>
                </Link></li>
              ))}</ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
