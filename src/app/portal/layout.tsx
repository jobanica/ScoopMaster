import Link from "next/link";
import { Bell, Home, Receipt, Boxes, Truck, Menu, IceCreamCone, LogOut } from "lucide-react";
import { requirePartner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logoutAction } from "../login/actions";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePartner();
  const [partner, unread] = await Promise.all([
    prisma.partner.findUniqueOrThrow({ where: { id: user.partnerId } }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  const nav = [
    { href: "/portal", label: "Home", icon: Home },
    { href: "/portal/sales", label: "Sales", icon: Receipt },
    { href: "/portal/inventory", label: "Stock", icon: Boxes },
    { href: "/portal/supply-requests", label: "Supplies", icon: Truck },
    { href: "/portal/more", label: "More", icon: Menu },
  ];
  return (
    <div className="min-h-screen pb-20">
      <header className="no-print sticky top-0 z-20 flex items-center justify-between bg-choco-800 px-4 py-3 text-cream-50">
        <Link href="/portal" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cream-200 text-choco-800"><IceCreamCone size={17} /></span>
          <span><span className="block text-xs font-extrabold tracking-widest">SCOOP MASTER</span><span className="block text-[11px] text-choco-100">{partner.businessName}</span></span>
        </Link>
        <div className="flex items-center gap-1">
          <Link href="/portal/notifications" className="relative rounded-lg p-2 hover:bg-choco-700" aria-label="Notifications"><Bell size={18} />{unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-berry-500 px-1.5 text-[10px] font-bold">{unread}</span>}</Link>
          <form action={logoutAction}><button className="rounded-lg p-2 hover:bg-choco-700" aria-label="Sign out"><LogOut size={18} /></button></form>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>
      <nav className="no-print fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-choco-100 bg-white">
        {nav.map((n) => <Link key={n.href} href={n.href} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-choco-600 hover:text-choco-900"><n.icon size={20} />{n.label}</Link>)}
      </nav>
    </div>
  );
}
