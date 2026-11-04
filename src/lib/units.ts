import { D, type DecimalLike, Decimal } from "./money";
import type { Uom } from "@prisma/client";

const MASS: Partial<Record<Uom, number>> = { KG: 1000, G: 1 };
const VOLUME: Partial<Record<Uom, number>> = { L: 1000, ML: 1 };

export const UOM_LABEL: Record<Uom, string> = {
  KG: "kg", G: "g", L: "L", ML: "mL", PC: "pc", BOX: "box", PACK: "pack", BAG: "bag",
};

export function canConvert(from: Uom, to: Uom): boolean {
  if (from === to) return true;
  return (from in MASS && to in MASS) || (from in VOLUME && to in VOLUME);
}

/** Convert a quantity between compatible units (kg↔g, L↔mL). Throws for incompatible units. */
export function convertQty(value: DecimalLike, from: Uom, to: Uom): Decimal {
  if (from === to) return D(value);
  const table = from in MASS ? MASS : from in VOLUME ? VOLUME : null;
  if (!table || !(to in table)) throw new Error(`Cannot convert ${from} to ${to}`);
  return D(value).times(table[from]!).dividedBy(table[to]!);
}
