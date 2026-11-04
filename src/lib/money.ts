import Decimal from "decimal.js";

// All money math goes through decimal.js. Never use JS floating point for currency.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type DecimalLike = Decimal.Value | { toString(): string } | null | undefined;

/** Convert anything (Prisma.Decimal, string, number, null) into a decimal.js Decimal. */
export function D(v: DecimalLike): Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  if (v instanceof Decimal) return v;
  if (typeof v === "number" || typeof v === "string") return new Decimal(v);
  return new Decimal(v.toString());
}

/** Round to centavos (2 dp, half-up). */
export function money(v: DecimalLike): Decimal {
  return D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Round a quantity / unit cost to 4 dp. */
export function qty(v: DecimalLike): Decimal {
  return D(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function sum(values: DecimalLike[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), new Decimal(0));
}

export function sumBy<T>(rows: T[], pick: (r: T) => DecimalLike): Decimal {
  return rows.reduce<Decimal>((acc, r) => acc.plus(D(pick(r))), new Decimal(0));
}

const phpFormatter = new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₱1,234.56 — formats via string to avoid float conversion of large values. */
export function formatPHP(v: DecimalLike, opts: { symbol?: boolean } = {}): string {
  const d = money(v);
  const neg = d.isNegative();
  const [int, frac] = d.abs().toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = `${opts.symbol === false ? "" : "₱"}${grouped}.${frac}`;
  return neg ? `-${body}` : body;
}

/** PHP 1,234.56 — for PDFs (standard PDF fonts do not include the ₱ glyph). */
export function formatPHPText(v: DecimalLike): string {
  return formatPHP(v).replace("₱", "PHP ");
}

export function formatQty(v: DecimalLike, dp = 2): string {
  const d = D(v);
  const fixed = d.toDecimalPlaces(dp).toString();
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

export function formatPct(v: DecimalLike, dp = 1): string {
  return `${D(v).toDecimalPlaces(dp).toString()}%`;
}

export { phpFormatter };

/** Serialize decimals for client components (strings keep precision). */
export function toStr(v: DecimalLike): string {
  return D(v).toString();
}

/** Parse a user-entered amount like "1,234.50" into a Decimal (throws on invalid input). */
export function parseAmount(input: string): Decimal {
  const cleaned = input.replace(/[₱,\s]/g, "").replace(/^PHP/i, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) throw new Error(`Invalid amount: ${input}`);
  return new Decimal(cleaned);
}
