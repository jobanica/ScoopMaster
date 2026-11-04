"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, Store, Cog, Receipt, Boxes, ChefHat, Truck, Wallet, HandCoins, Scale, BarChart3, Bell, Users, ShieldCheck, SlidersHorizontal, Menu, X, IceCreamCone,
} from "lucide-react";

const ICONS = { LayoutDashboard, Store, Cog, Receipt, Boxes, ChefHat, Truck, Wallet, HandCoins, Scale, BarChart3, Bell, Users, ShieldCheck, SlidersHorizontal };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; section?: string };

export function Sidebar({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  let lastSection: string | undefined;
  const list = (
    <nav className="flex flex-col gap-0.5 p-3">
      {items.map((it) => {
        const Icon = ICONS[it.icon];
        const active = path === it.href || (it.href !== "/dashboard" && path.startsWith(it.href + "/")) || path === it.href;
        const header = it.section && it.section !== lastSection ? it.section : null;
        lastSection = it.section ?? lastSection;
        return (
          <div key={it.href}>
            {header && <p className="mb-1 mt-4 px-3 text-[10px] font-bold uppercase tracking-widest text-choco-300">{header}</p>}
            <Link
              href={it.href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${active ? "bg-cream-200 text-choco-900" : "text-choco-100 hover:bg-choco-700 hover:text-white"}`}
            >
              <Icon size={17} />
              <span className="flex-1">{it.label}</span>
              {!!it.badge && <span className="rounded-full bg-berry-500 px-1.5 text-[10px] font-bold text-white">{it.badge}</span>}
            </Link>
          </div>
        );
      })}
    </nav>
  );
  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2 px-5 py-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cream-200 text-choco-800"><IceCreamCone size={20} /></span>
      <span>
        <span className="block text-sm font-extrabold tracking-widest text-cream-50">SCOOP MASTER</span>
        <span className="block text-[10px] text-choco-300">Soft-Serve Business Management</span>
      </span>
    </Link>
  );
  return (
    <>
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 overflow-y-auto bg-choco-800 lg:block">{brand}{list}</aside>
      <button className="no-print fixed left-3 top-3 z-40 rounded-lg bg-choco-800 p-2 text-cream-50 lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
      {open && (
        <div className="no-print fixed inset-0 z-30 bg-choco-900/40 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-64 overflow-y-auto bg-choco-800 pt-10" onClick={(e) => e.stopPropagation()}>{brand}{list}</aside>
        </div>
      )}
    </>
  );
}
