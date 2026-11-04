import { prisma } from "@/lib/db";
import { addDays, fmtDate, todayDate, ymd } from "@/lib/dates";
import { UOM_LABEL } from "@/lib/units";
import { balanceOf } from "@/lib/calc/payments";
import { getRule, notify } from "./notifications";
import { lowStockItems, partnerLowStock } from "./inventory";
import { partnersMissingReports } from "./sales";
import { suggestNextPeriod } from "./settlements";

/** Scans for time-based conditions and creates de-duplicated notifications. Safe to run repeatedly (cron or manual). */
export async function runScheduledChecks() {
  const today = todayDate();
  const t = ymd(today);
  const counts: Record<string, number> = {};
  const add = (k: string, n: number) => (counts[k] = (counts[k] ?? 0) + n);

  const missingRule = await getRule("MISSING_SALES_REPORT");
  if (missingRule.enabled) {
    const day = addDays(today, -Math.max(1, missingRule.threshold));
    for (const p of await partnersMissingReports(day)) add("missing", await notify("MISSING_SALES_REPORT", { title: `${p.businessName} has not submitted sales for ${fmtDate(day)}`, link: `/partners/${p.id}?tab=sales`, severity: "WARNING", dedupeKey: `missing-${p.id}-${ymd(day)}`, partnerId: p.id, partnerLink: "/portal/sales/new" }));
  }

  for (const r of await lowStockItems()) add("low", await notify("LOW_STOCK", { title: `Low stock: ${r.item.name}`, body: `Warehouse has ${r.onHand.toString()} ${UOM_LABEL[r.item.uom]} (minimum ${r.item.minStock.toString()}).`, link: `/inventory/items/${r.item.id}`, severity: "WARNING", dedupeKey: `low-${r.item.id}-${t}` }));
  for (const l of await partnerLowStock()) add("low", await notify("LOW_STOCK", { title: `Low stock at ${l.location.name}: ${l.item.name}`, body: `${l.quantity.toString()} ${UOM_LABEL[l.item.uom]} left.`, link: `/partners/${l.location.partnerId}?tab=inventory`, severity: "INFO", dedupeKey: `plow-${l.id}-${t}` }));

  const expRule = await getRule("EXPIRING_STOCK");
  const batches = await prisma.stockBatch.findMany({ where: { quantity: { gt: 0 }, expiryDate: { lte: addDays(today, expRule.threshold) } }, include: { item: true, location: true } });
  for (const b of batches) add("expiring", await notify("EXPIRING_STOCK", { title: `${b.expiryDate! < today ? "Expired" : "Expiring"}: ${b.item.name} batch ${b.batchNo}`, body: `${b.quantity.toString()} ${UOM_LABEL[b.item.uom]} at ${b.location.name}, expiry ${fmtDate(b.expiryDate)}.`, link: `/inventory/items/${b.itemId}`, severity: b.expiryDate! < today ? "CRITICAL" : "WARNING", dedupeKey: `exp-${b.id}-${b.expiryDate! < today ? "past" : "soon"}` }));

  const open = await prisma.invoice.findMany({ where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } }, include: { partner: true, contact: true } });
  const dueRule = await getRule("PAYMENT_DUE_SOON");
  for (const i of open) {
    const who = i.partner?.businessName ?? i.contact?.name ?? "";
    if (i.dueDate < today) add("overdue", await notify("PAYMENT_OVERDUE", { title: `Overdue: ${i.number} (${who})`, body: `Balance ₱${balanceOf(i).toFixed(2)}, due ${fmtDate(i.dueDate)}.`, link: `/finance/invoices/${i.id}`, severity: "CRITICAL", dedupeKey: `od-${i.id}-${ymd(i.dueDate)}`, partnerId: i.partnerId, partnerLink: "/portal/invoices" }));
    else if (i.dueDate <= addDays(today, dueRule.threshold)) add("dueSoon", await notify("PAYMENT_DUE_SOON", { title: `Due ${fmtDate(i.dueDate)}: ${i.number} (${who})`, body: `Balance ₱${balanceOf(i).toFixed(2)}.`, link: `/finance/invoices/${i.id}`, dedupeKey: `due-${i.id}-${ymd(i.dueDate)}`, partnerId: i.partnerId, partnerLink: "/portal/invoices" }));
  }
  const bills = await prisma.bill.findMany({ where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] }, dueDate: { lte: addDays(today, dueRule.threshold) } } });
  for (const b of bills) add(b.dueDate < today ? "overdue" : "dueSoon", await notify(b.dueDate < today ? "PAYMENT_OVERDUE" : "PAYMENT_DUE_SOON", { title: `${b.dueDate < today ? "Overdue payable" : "Payable due"}: ${b.number} to ${b.payeeName}`, body: `₱${balanceOf(b).toFixed(2)} due ${fmtDate(b.dueDate)}.`, link: `/finance/bills/${b.id}`, severity: b.dueDate < today ? "CRITICAL" : "INFO", dedupeKey: `bill-${b.id}-${b.dueDate < today ? "od" : "due"}` }));

  const mRule = await getRule("MAINTENANCE_DUE");
  const machines = await prisma.machine.findMany({ where: { nextMaintenanceDate: { lte: addDays(today, mRule.threshold) }, status: { not: "SOLD" } } });
  for (const m of machines) add("maintenance", await notify("MAINTENANCE_DUE", { title: `Maintenance due: ${m.code}`, body: `Scheduled ${fmtDate(m.nextMaintenanceDate)}.`, link: `/machines/${m.id}`, severity: m.nextMaintenanceDate! < today ? "WARNING" : "INFO", dedupeKey: `mnt-${m.id}-${ymd(m.nextMaintenanceDate!)}` }));

  const cRule = await getRule("CONTRACT_EXPIRING");
  const contracts = await prisma.partnerContract.findMany({ where: { isActive: true, effectiveTo: { not: null, lte: addDays(today, cRule.threshold) } }, include: { partner: true } });
  for (const c of contracts) add("contracts", await notify("CONTRACT_EXPIRING", { title: `Contract ${c.effectiveTo! < today ? "expired" : "expiring"}: ${c.partner.businessName}`, body: `Contract v${c.version} ends ${fmtDate(c.effectiveTo)}.`, link: `/partners/${c.partnerId}?tab=contract`, severity: "WARNING", dedupeKey: `ctr-${c.id}-${ymd(c.effectiveTo!)}` }));

  // Settlements due per each partner's schedule
  const active = await prisma.partner.findMany({ where: { status: { in: ["ACTIVE", "ON_HOLD"] }, contracts: { some: { isActive: true } } } });
  for (const p of active) {
    const s = await suggestNextPeriod(p.id);
    const fullEnd = s.end;
    if (fullEnd < today) {
      const draft = await prisma.settlement.findFirst({ where: { partnerId: p.id, status: { not: "VOIDED" }, periodStart: s.start } });
      if (!draft) add("settlements", await notify("SETTLEMENT_READY", { title: `Settlement due: ${p.businessName}`, body: `Period ${fmtDate(s.start)} – ${fmtDate(fullEnd)} can now be settled.`, link: `/settlements/new?partnerId=${p.id}`, dedupeKey: `stldue-${p.id}-${ymd(s.start)}` }));
    }
  }
  await prisma.auditLog.create({ data: { action: "ALERT_SCAN", entityType: "System", summary: JSON.stringify(counts) } });
  return counts;
}
