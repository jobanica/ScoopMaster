// Business timezone is Asia/Manila (UTC+8, no DST). Business dates are stored in @db.Date
// columns as midnight UTC of the Manila calendar date, e.g. 04/11/2026 → 2026-11-04T00:00:00Z.

export const TZ = "Asia/Manila";

const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
});

/** YYYY-MM-DD of an instant in Manila. */
export function manilaYmd(d: Date = new Date()): string {
  return ymdFmt.format(d);
}

/** Business-date Date (UTC midnight) for a YYYY-MM-DD string. */
export function dateFromYmd(ymd: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`Invalid date: ${ymd}`);
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd) throw new Error(`Invalid date: ${ymd}`);
  return d;
}

/** Today's business date in Manila. */
export function todayDate(): Date {
  return dateFromYmd(manilaYmd());
}

/** YYYY-MM-DD of a business date (stored as UTC midnight). */
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

export function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** DD/MM/YYYY for a business date (@db.Date). */
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const s = typeof d === "string" ? d.slice(0, 10) : ymd(d);
  const [y, m, day] = s.split("-");
  return `${day}/${m}/${y}`;
}

/** DD/MM/YYYY hh:mm am for a timestamp, in Manila time. */
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return dateTimeFmt.format(typeof d === "string" ? new Date(d) : d).replace(",", "");
}

/** Parse DD/MM/YYYY or YYYY-MM-DD into a business date. */
export function parseDateInput(input: string): Date {
  const s = input.trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return dateFromYmd(m ? `${m[3]}-${m[2]}-${m[1]}` : s);
}

/** Start instant (UTC) of a Manila business date — for filtering timestamp columns. */
export function manilaDayStart(d: Date): Date {
  return new Date(d.getTime() - 8 * 3600 * 1000);
}

export function monthLabel(d: Date): string {
  return d.toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}
