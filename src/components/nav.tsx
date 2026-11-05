"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, Store, Cog, Receipt, Boxes, ChefHat, Truck, Wallet, HandCoins, Scale, BarChart3, Bell, Users, ShieldCheck, SlidersHorizontal, Menu, X, ClipboardCheck,
} from "lucide-react";

const ICONS = { LayoutDashboard, Store, Cog, Receipt, Boxes, ChefHat, Truck, Wallet, HandCoins, Scale, BarChart3, Bell, Users, ShieldCheck, SlidersHorizontal };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; section?: string };
export type TodoItem = { label: string; count: number; href: string };

/** Floating chocolate sidebar: active page as a vanilla pill, "Today's to-do" card with real pending work. */
export function Sidebar({ items, todo }: { items: NavItem[]; todo: TodoItem[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  let lastSection: string | undefined;
  const pending = todo.filter((t) => t.count > 0);
  const list = (
    <nav className="flex flex-col gap-0.5 px-3 pb-3">
      {items.map((it) => {
        const Icon = ICONS[it.icon];
        const active = path === it.href || (it.href !== "/dashboard" && path.startsWith(it.href + "/"));
        const header = it.section && it.section !== lastSection ? it.section : null;
        lastSection = it.section ?? lastSection;
        return (
          <div key={it.href}>
            {header && <p className="mb-1 mt-4 px-3 text-[10px] font-bold uppercase tracking-widest text-choco-300/80">{header}</p>}
            <Link
              href={it.href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] transition ${active ? "bg-vanilla-400 font-semibold text-choco-900 shadow-sm" : "font-medium text-choco-100 hover:bg-white/10 hover:text-white"}`}
            >
              <Icon size={17} />
              <span className="flex-1">{it.label}</span>
              {!!it.badge && <span className={`rounded-full px-1.5 text-[10px] font-bold ${active ? "bg-choco-800 text-cream-50" : "bg-berry-500 text-white"}`}>{it.badge}</span>}
            </Link>
          </div>
        );
      })}
    </nav>
  );
  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-5 pb-4 pt-5" onClick={() => setOpen(false)}>
      <Image src="/brand/mark.png" alt="" width={236} height={278} className="h-11 w-auto drop-shadow" priority />
      <span>
        <span className="block text-sm font-extrabold tracking-widest text-cream-50">SCOOP MASTER</span>
        <span className="block text-[10px] italic text-vanilla-400">Your Partner in Every Scoop.</span>
      </span>
    </Link>
  );
  const todoCard = (
    <div className="m-3 rounded-2xl bg-gradient-to-br from-choco-600 to-choco-700 p-4 text-cream-50">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15"><ClipboardCheck size={18} /></span>
      <p className="mt-3 text-sm font-bold text-vanilla-400">Today&apos;s to-do</p>
      {pending.length === 0 ? <p className="mt-1 text-xs text-choco-100">All caught up — nothing waiting for review.</p> : (
        <ul className="mt-2 space-y-1 text-xs">
          {pending.map((t) => <li key={t.label} className="flex justify-between"><span className="text-choco-100">{t.label}</span><span className="font-bold">{t.count}</span></li>)}
        </ul>
      )}
      {pending[0] && <Link href={pending[0].href} onClick={() => setOpen(false)} className="mt-3 flex min-h-[36px] w-full items-center justify-center rounded-xl bg-vanilla-400 text-xs font-bold text-choco-900 hover:bg-vanilla-100">Review now</Link>}
    </div>
  );
  const panel = (
    <div className="flex h-full flex-col">
      {brand}
      <div className="flex-1 overflow-y-auto">{list}</div>
      {todoCard}
    </div>
  );
  return (
    <>
      <aside className="no-print fixed bottom-4 left-4 top-4 z-30 hidden w-60 overflow-hidden rounded-3xl bg-choco-800 shadow-xl lg:block">{panel}</aside>
      <button className="no-print fixed left-[1.6rem] top-[1.85rem] z-40 flex h-9 w-9 items-center justify-center rounded-full bg-cream-100 text-choco-800 lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
      {open && (
        <div className="no-print fixed inset-0 z-30 bg-choco-900/40 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-64 overflow-hidden rounded-r-3xl bg-choco-800 pt-12" onClick={(e) => e.stopPropagation()}>{panel}</aside>
        </div>
      )}
    </>
  );
}
