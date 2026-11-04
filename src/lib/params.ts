import { fmtDate, parseDateInput, startOfMonth, todayDate } from "./dates";

export type SP = Promise<Record<string, string | string[] | undefined>>;

export function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v || undefined;
}

export function dateParam(v: string | string[] | undefined): Date | null {
  const s = one(v);
  if (!s) return null;
  try { return parseDateInput(s); } catch { return null; }
}

/** from/to query params (DD/MM/YYYY); defaults to month-to-date. */
export function rangeParams(sp: Record<string, string | string[] | undefined>, defaults?: { from: Date; to: Date }) {
  const today = todayDate();
  const from = dateParam(sp.from) ?? defaults?.from ?? startOfMonth(today);
  const to = dateParam(sp.to) ?? defaults?.to ?? today;
  return { from, to, fromText: fmtDate(from), toText: fmtDate(to) };
}

export function pageParam(v: string | string[] | undefined): number {
  const n = Number(one(v));
  return Number.isInteger(n) && n > 0 ? n : 1;
}
