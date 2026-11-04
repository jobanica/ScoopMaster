import { AppError } from "./errors";
import { parseDateInput } from "./dates";
import { parseAmount } from "./money";

export function str(fd: FormData, name: string, label = name): string {
  const v = fd.get(name);
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw new AppError(`${label} is required.`);
  if (s.length > 2000) throw new AppError(`${label} is too long.`);
  return s;
}
export function optStr(fd: FormData, name: string): string | null {
  const v = fd.get(name);
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, 5000) : null;
}
export function date(fd: FormData, name: string, label = name): Date {
  const s = str(fd, name, label);
  try { return parseDateInput(s); } catch { throw new AppError(`${label} is not a valid date.`); }
}
export function optDate(fd: FormData, name: string, label = name): Date | null {
  const s = optStr(fd, name);
  if (!s) return null;
  try { return parseDateInput(s); } catch { throw new AppError(`${label} is not a valid date.`); }
}
/** Decimal string (validated, commas/₱ stripped). */
export function amount(fd: FormData, name: string, label = name, opts: { optional?: boolean; allowNegative?: boolean } = {}): string {
  const s = opts.optional ? optStr(fd, name) : str(fd, name, label);
  if (!s) return "0";
  let d;
  try { d = parseAmount(s); } catch { throw new AppError(`${label} must be a number.`); }
  if (d.isNegative() && !opts.allowNegative) throw new AppError(`${label} cannot be negative.`);
  return d.toString();
}
export function int(fd: FormData, name: string, label = name, opts: { min?: number; max?: number; optional?: boolean } = {}): number {
  const s = opts.optional ? optStr(fd, name) ?? "0" : str(fd, name, label);
  if (!/^-?\d+$/.test(s)) throw new AppError(`${label} must be a whole number.`);
  const n = Number(s);
  if (opts.min !== undefined && n < opts.min) throw new AppError(`${label} must be at least ${opts.min}.`);
  if (opts.max !== undefined && n > opts.max) throw new AppError(`${label} must be at most ${opts.max}.`);
  return n;
}
export function bool(fd: FormData, name: string): boolean {
  const v = fd.get(name);
  return v === "on" || v === "true" || v === "1";
}
export function oneOf<T extends string>(fd: FormData, name: string, values: readonly T[], label = name): T {
  const s = str(fd, name, label);
  if (!values.includes(s as T)) throw new AppError(`${label} is invalid.`);
  return s as T;
}
export function email(fd: FormData, name: string, opts: { optional?: boolean } = {}): string | null {
  const s = opts.optional ? optStr(fd, name) : str(fd, name, "Email");
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new AppError("Email address is not valid.");
  return s.toLowerCase();
}
