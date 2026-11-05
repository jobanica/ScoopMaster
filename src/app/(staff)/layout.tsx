import Link from "next/link";
import { Bell, ChevronDown, LogOut, Search, UserRound } from "lucide-react";
import { requirePage } from "@/lib/auth";
import { can, ROLE_LABEL, type Permission } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Sidebar, type NavItem } from "@/components/nav";
import { logoutAction } from "../login/actions";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePage();
  if (user.role === "PARTNER") {
    const { redirect } = await import("next/navigation");
    redirect("/portal");
  }
  const [unread, pendingSales, pendingSupply, pendingPayments] = await Promise.all([
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    can(user.role, "sales:review") ? prisma.salesReport.count({ where: { status: "SUBMITTED" } }) : 0,
    can(user.role, "supply:review") ? prisma.supplyOrder.count({ where: { status: "REQUESTED" } }) : 0,
    can(user.role, "payments:verify") ? prisma.payment.count({ where: { status: "PENDING_VERIFICATION" } }) : 0,
  ]);
  const all: (NavItem & { perm: Permission })[] = [
    { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", perm: "dashboard:view" },
    { href: "/partners", label: "Partners", icon: "Store", perm: "partners:read", section: "Operations" },
    { href: "/machines", label: "Machines", icon: "Cog", perm: "machines:read", section: "Operations" },
    { href: "/sales", label: "Sales Reports", icon: "Receipt", perm: "sales:read", badge: pendingSales, section: "Operations" },
    { href: "/inventory", label: "Inventory", icon: "Boxes", perm: "inventory:read", section: "Supply chain" },
    { href: "/recipes", label: "Recipes & Products", icon: "ChefHat", perm: "recipes:read", section: "Supply chain" },
    { href: "/supply-orders", label: "Supply Orders", icon: "Truck", perm: "supply:read", badge: pendingSupply, section: "Supply chain" },
    { href: "/finance", label: "Finance", icon: "Wallet", perm: "finance:read", badge: pendingPayments, section: "Money" },
    { href: "/collections", label: "Collections", icon: "HandCoins", perm: "finance:read", section: "Money" },
    { href: "/settlements", label: "Settlements", icon: "Scale", perm: "settlements:read", section: "Money" },
    { href: "/reports", label: "Reports", icon: "BarChart3", perm: "reports:view", section: "Insights" },
    { href: "/notifications", label: "Notifications", icon: "Bell", perm: "dashboard:view", badge: unread, section: "Insights" },
    { href: "/admin/users", label: "Users", icon: "Users", perm: "users:manage", section: "Administration" },
    { href: "/admin/payment-settings", label: "Payment Details", icon: "Wallet", perm: "finance:write", section: "Administration" },
    { href: "/admin/notification-rules", label: "Alert Rules", icon: "SlidersHorizontal", perm: "notifications:manage", section: "Administration" },
    { href: "/admin/audit", label: "Audit Log", icon: "ShieldCheck", perm: "audit:read", section: "Administration" },
  ];
  const items = all.filter((i) => can(user.role, i.perm)).map(({ perm: _p, ...rest }) => rest);
  const todo = [
    ...(can(user.role, "sales:review") ? [{ label: "Sales reports to approve", count: pendingSales, href: "/sales?status=SUBMITTED" }] : []),
    ...(can(user.role, "payments:verify") ? [{ label: "Payments to verify", count: pendingPayments, href: "/finance/payments?status=PENDING_VERIFICATION" }] : []),
    ...(can(user.role, "supply:review") ? [{ label: "Supply requests", count: pendingSupply, href: "/supply-orders?status=REQUESTED" }] : []),
  ];
  const initials = user.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="min-h-screen bg-cream-100">
      <Sidebar items={items} todo={todo} />
      <div className="lg:pl-[17rem]">
        <header className="no-print sticky top-0 z-20 px-4 pt-4 sm:px-6 lg:pl-2">
          <div className="flex min-h-[3.5rem] items-center gap-3 rounded-2xl bg-white/95 py-2.5 pl-14 pr-3 shadow-card backdrop-blur lg:pl-4">
            <form action="/search" className="relative hidden flex-1 sm:block sm:max-w-md">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-choco-300" />
              <input name="q" type="search" placeholder="Search partners, machines, reports, invoices…" className="w-full rounded-full border border-choco-50 bg-cream-50 py-2 pl-9 pr-4 text-base text-choco-900 placeholder:text-choco-300 focus:border-choco-300 focus:outline-none sm:text-sm" />
            </form>
            <div className="ml-auto flex items-center gap-1.5">
              <Link href="/search" className="rounded-full p-2 text-choco-600 hover:bg-cream-100 sm:hidden" aria-label="Search"><Search size={18} /></Link>
              <Link href="/notifications" className="relative rounded-full p-2 text-choco-600 hover:bg-cream-100" aria-label="Notifications">
                <Bell size={18} />
                {unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-berry-500 px-1.5 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
              </Link>
              <details className="relative">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-cream-100 [&::-webkit-details-marker]:hidden">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-choco-700 text-xs font-bold text-cream-50">{initials}</span>
                  <span className="hidden text-left sm:block">
                    <span className="block text-sm font-semibold leading-tight text-choco-900">{user.name}</span>
                    <span className="block text-[11px] text-choco-500">{ROLE_LABEL[user.role]}</span>
                  </span>
                  <ChevronDown size={14} className="text-choco-400" />
                </summary>
                <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-choco-50 bg-white py-1 shadow-xl">
                  <p className="px-4 py-2 text-xs text-choco-500">{user.email}</p>
                  <Link href="/notifications" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-cream-50"><Bell size={15} /> Notifications</Link>
                  {can(user.role, "users:manage") && <Link href="/admin/users" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-cream-50"><UserRound size={15} /> Users &amp; passwords</Link>}
                  <form action={logoutAction}><button className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-berry-700 hover:bg-cream-50"><LogOut size={15} /> Sign out</button></form>
                </div>
              </details>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:pl-2">{children}</main>
      </div>
    </div>
  );
}
