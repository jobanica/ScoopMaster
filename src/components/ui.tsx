import Link from "next/link";
import type { ReactNode } from "react";
import { formatPHP, type DecimalLike } from "@/lib/money";
import { fmtDate } from "@/lib/dates";

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {back && <Link href={back.href} className="no-print mb-1 inline-block text-xs font-medium text-choco-500 hover:underline">← {back.label}</Link>}
        <h1 className="text-2xl font-bold tracking-tight text-choco-900">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-choco-500">{subtitle}</div>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-choco-50 px-5 py-3">
          <h2 className="text-sm font-semibold text-choco-800">{title}</h2>
          {actions && <div className="no-print flex gap-2">{actions}</div>}
        </div>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

const TONES = {
  choco: "bg-choco-50 text-choco-700",
  berry: "bg-berry-50 text-berry-700",
  mint: "bg-mint-50 text-mint-700",
  vanilla: "bg-vanilla-50 text-vanilla-700",
  sky: "bg-sky-50 text-sky-700",
  gray: "bg-gray-100 text-gray-600",
} as const;
export type Tone = keyof typeof TONES;

export function Stat({ label, value, hint, tone = "choco", href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; href?: string }) {
  const body = (
    <div className="card h-full p-4 transition hover:border-choco-300">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${TONES[tone].split(" ")[0].replace("-50", "-400")}`} />
        <p className="text-xs font-semibold uppercase tracking-wide text-choco-500">{label}</p>
      </div>
      <p className="mt-2 text-xl font-bold tabular-nums text-choco-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-choco-500">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "mint", APPROVED: "mint", PAID: "mint", CONFIRMED: "mint", FINALIZED: "mint", RECEIVED: "mint", RESOLVED: "mint", POSTED: "mint", DEPLOYED: "mint", AVAILABLE: "sky",
  PROSPECT: "sky", PENDING_APPROVAL: "vanilla", PENDING: "vanilla", PENDING_VERIFICATION: "vanilla", SUBMITTED: "vanilla", REQUESTED: "vanilla", PREPARING: "vanilla", DISPATCHED: "sky", IN_PROGRESS: "vanilla", OPEN: "vanilla", RESERVED: "vanilla", PARTIALLY_PAID: "vanilla", DRAFT: "gray", UNPAID: "choco",
  ON_HOLD: "vanilla", UNDER_MAINTENANCE: "vanilla", RETURNED: "gray", SOLD: "gray",
  TERMINATED: "berry", REJECTED: "berry", CANCELLED: "gray", VOIDED: "gray", OVERDUE: "berry",
  INFO: "sky", WARNING: "vanilla", CRITICAL: "berry",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "gray"}>{label ?? humanize(status)}</Badge>;
}

export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TONES[tone]}`}>{children}</span>;
}

export function humanize(s: string): string {
  return s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function Peso({ v, className = "" }: { v: DecimalLike; className?: string }) {
  const s = formatPHP(v);
  return <span className={`tabular-nums ${s.startsWith("-") ? "text-berry-700" : ""} ${className}`}>{s}</span>;
}

export function DateText({ d }: { d: Date | string | null | undefined }) {
  return <span className="whitespace-nowrap">{fmtDate(d)}</span>;
}

export function Empty({ children = "No records yet." }: { children?: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-choco-100 px-4 py-10 text-center text-sm text-choco-500">{children}</div>;
}

export function DL({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 }) {
  const grid = cols === 3 ? "sm:grid-cols-3" : cols === 2 ? "sm:grid-cols-2" : "";
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-3 ${grid}`}>
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-choco-500">{k}</dt>
          <dd className="mt-0.5 text-sm text-choco-900">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <div className="no-print mb-5 flex gap-1 overflow-x-auto border-b border-choco-100">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${t.key === active ? "border-choco-700 text-choco-900" : "border-transparent text-choco-500 hover:text-choco-800"}`}>
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-cream-200 px-1.5 text-xs">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function LinkButton({ href, children, variant = "primary", size }: { href: string; children: ReactNode; variant?: "primary" | "secondary"; size?: "sm" }) {
  return <Link href={href} className={`${variant === "primary" ? "btn-primary" : "btn-secondary"} ${size === "sm" ? "btn-sm" : ""}`}>{children}</Link>;
}

export function Alert({ tone = "vanilla", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${TONES[tone]}`}>{children}</div>;
}

/** Simple GET filter bar; children are inputs with `name`. */
export function FilterBar({ children, action }: { children: ReactNode; action?: string }) {
  return (
    <form method="get" action={action} className="no-print mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-choco-100 bg-white p-3">
      {children}
      <button className="btn-secondary btn-sm" type="submit">Apply</button>
    </form>
  );
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-[140px]">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Pagination({ page, pageSize, total, params }: { page: number; pageSize: number; total: number; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => "?" + new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>, page: String(p) }).toString();
  return (
    <div className="no-print mt-4 flex items-center justify-between text-sm text-choco-600">
      <span>Page {page} of {pages} · {total} records</span>
      <div className="flex gap-2">
        {page > 1 && <Link className="btn-secondary btn-sm" href={href(page - 1)}>Previous</Link>}
        {page < pages && <Link className="btn-secondary btn-sm" href={href(page + 1)}>Next</Link>}
      </div>
    </div>
  );
}
