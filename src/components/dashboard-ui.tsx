import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";
import type { Decimal } from "@/lib/money";

const ICON_TONE = {
  cream: "bg-cream-200 text-choco-700",
  vanilla: "bg-vanilla-100 text-vanilla-700",
  berry: "bg-berry-100 text-berry-700",
  mint: "bg-mint-100 text-mint-700",
  sky: "bg-sky-100 text-sky-700",
  choco: "bg-choco-100 text-choco-700",
} as const;
export type IconTone = keyof typeof ICON_TONE;

/** Top summary card: round icon badge, small label, big number (as in the reference design). */
export function KpiCard({ icon, tone, label, value, hint, href }: { icon: ReactNode; tone: IconTone; label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <div className="group flex h-full min-w-[15rem] items-center gap-4 rounded-2xl bg-white p-4 shadow-card transition hover:shadow-lg sm:min-w-0">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${ICON_TONE[tone]}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-choco-500">{label}</p>
        <p className="truncate text-2xl font-bold tabular-nums text-choco-900">{value}</p>
        {hint && <p className="truncate text-[11px] text-choco-400">{hint}</p>}
      </div>
      {href && <ArrowUpRight size={16} className="self-start text-choco-300 transition group-hover:text-choco-700" />}
    </div>
  );
  return href ? <Link href={href} className="snap-start">{body}</Link> : <div className="snap-start">{body}</div>;
}

export function TrendPill({ pct, label = "vs last period" }: { pct: Decimal | null; label?: string }) {
  if (pct === null) return <span className="text-[11px] text-choco-400">No earlier data to compare</span>;
  const up = !pct.isNegative();
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-choco-400">
      <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold ${up ? "bg-mint-100 text-mint-700" : "bg-berry-100 text-berry-700"}`}>
        {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{up ? "+" : ""}{pct.toFixed(Math.abs(pct.toNumber()) < 10 ? 1 : 0)}%
      </span>
      {label}
    </span>
  );
}

/** Metric card for the grid; `highlight` renders the dark chocolate featured card. */
export function MetricCard({ label, value, icon, trend, sub, href, highlight }: { label: string; value: ReactNode; icon: ReactNode; trend?: Decimal | null; sub?: ReactNode; href?: string; highlight?: boolean }) {
  const body = (
    <div className={`group flex h-full min-w-[13.5rem] flex-col justify-between gap-3 rounded-2xl p-4 transition sm:min-w-0 ${highlight ? "bg-gradient-to-br from-choco-700 to-choco-800 text-cream-50 shadow-lg" : "bg-white shadow-card hover:shadow-lg"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-xs font-semibold ${highlight ? "text-cream-200" : "text-choco-600"}`}>{label}</p>
        {href && <ArrowUpRight size={15} className={highlight ? "text-cream-200" : "text-choco-300 group-hover:text-choco-700"} />}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className={`truncate text-[1.35rem] font-bold leading-tight tabular-nums ${highlight ? "text-white" : "text-choco-900"}`}>{value}</p>
          <div className={`mt-1 ${highlight ? "[&_span]:!text-cream-200" : ""}`}>{trend !== undefined ? <TrendPill pct={trend} /> : sub ? <span className={`text-[11px] ${highlight ? "text-cream-200" : "text-choco-400"}`}>{sub}</span> : null}</div>
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${highlight ? "bg-vanilla-400 text-choco-900" : "bg-cream-100 text-choco-700"}`}>{icon}</span>
      </div>
    </div>
  );
  return href ? <Link href={href} className="snap-start">{body}</Link> : <div className="snap-start">{body}</div>;
}
