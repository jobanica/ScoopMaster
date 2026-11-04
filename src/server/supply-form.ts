import { optStr } from "@/lib/form";

export function parseSupplyLines(fd: FormData) {
  return fd.getAll("row").map(String).map((r) => ({ itemId: optStr(fd, `item_${r}`) ?? "", quantity: (optStr(fd, `qty_${r}`) ?? "").replace(/,/g, "") })).filter((l) => l.itemId && l.quantity);
}

export function qtyMap(fd: FormData, prefix: string) {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith(prefix) && typeof v === "string" && v.trim() !== "") out[k.slice(prefix.length)] = v.replace(/,/g, "").trim();
  return out;
}
