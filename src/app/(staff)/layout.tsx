import Link from "next/link";
import { Bell, LogOut } from "lucide-react";
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

  return (
    <div className="min-h-screen">
      <Sidebar items={items} />
      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex items-center justify-end gap-3 border-b border-choco-100 bg-cream-50/90 px-4 py-3 backdrop-blur sm:px-6">
          <Link href="/notifications" className="relative rounded-lg p-2 text-choco-600 hover:bg-cream-200" aria-label="Notifications">
            <Bell size={18} />
            {unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-berry-500 px-1.5 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
          </Link>
          <div className="text-right">
            <p className="text-sm font-semibold text-choco-900">{user.name}</p>
            <p className="text-xs text-choco-500">{ROLE_LABEL[user.role]}</p>
          </div>
          <form action={logoutAction}>
            <button className="rounded-lg p-2 text-choco-600 hover:bg-cream-200" aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
          </form>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
