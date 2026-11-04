/**
 * OPTIONAL demo data for testing and training. Never run against production.
 * Everything is created through the real services, so demo data obeys the same business rules
 * (ledger movements, invoices, settlements, audit logs).
 */
import { prisma } from "../src/lib/db";
import { addDays, todayDate, startOfMonth, endOfMonth } from "../src/lib/dates";
import type { Actor } from "../src/server/actor";
import { saveItem, saveRecipe, saveProduct } from "../src/server/services/catalog";
import { receiveStock } from "../src/server/services/inventory";
import { createPartner, createContract, changePartnerStatus, setProductPrice, createUser } from "../src/server/services/partners";
import { createMachine, assignMachine, reportMachineProblem } from "../src/server/services/machines";
import { createSupplyRequest, reviewSupplyOrder, dispatchSupplyOrder, confirmSupplyReceipt } from "../src/server/services/supply";
import { saveSalesReport, approveSalesReport } from "../src/server/services/sales";
import { submitPartnerExpense, reviewPartnerExpense, recordPayment, saveContact, recordExpense } from "../src/server/services/finance";
import { createSettlement, submitSettlement, finalizeSettlement } from "../src/server/services/settlements";
import { hashPassword } from "../src/lib/password";

async function main() {
  if ((await prisma.partner.count()) > 0 && !process.argv.includes("--force")) {
    console.log("Partners already exist — demo data not loaded. Use --force to add anyway.");
    return;
  }
  const root = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (!root) throw new Error("Run `npm run db:seed` first.");
  const pw = await hashPassword("DemoPass123");
  const mk = async (email: string, name: string, role: "ADMIN" | "FINANCE" | "WAREHOUSE" | "OPERATIONS") => {
    const u = await prisma.user.upsert({ where: { email }, update: {}, create: { email, name, role, passwordHash: pw } });
    return { id: u.id, role: u.role, partnerId: null } as Actor;
  };
  const admin = await mk("admin.demo@scoopmaster.local", "Ana Admin", "ADMIN");
  const finance = await mk("finance.demo@scoopmaster.local", "Fe Finance", "FINANCE");
  const wh = await mk("warehouse.demo@scoopmaster.local", "Wally Warehouse", "WAREHOUSE");
  await mk("ops.demo@scoopmaster.local", "Oscar Operations", "OPERATIONS");

  const supplier = await saveContact(admin, { type: "SUPPLIER", name: "Demo Dairy Supplies Inc.", phone: "0917 000 0000" });
  const tech = await saveContact(admin, { type: "TECHNICIAN", name: "Demo Refrigeration Services" });

  const item = (sku: string, name: string, category: Parameters<typeof saveItem>[1]["category"], uom: Parameters<typeof saveItem>[1]["uom"], cost: string, price: string, min: string, pmin: string, perishable = false) =>
    saveItem(admin, { sku, name, category, uom, purchaseCost: cost, partnerPrice: price, minStock: min, partnerMinStock: pmin, supplierId: supplier.id, isPerishable: perishable, isSellable: true, isActive: true });
  const van = await item("PWD-VAN", "Vanilla soft-serve powder", "ICE_CREAM_POWDER", "KG", "320", "420", "10", "2", true);
  const choc = await item("PWD-CHO", "Chocolate soft-serve powder", "ICE_CREAM_POWDER", "KG", "340", "440", "10", "2", true);
  const cone = await item("CONE-STD", "Wafer cone", "CONES", "PC", "1.20", "1.80", "500", "100");
  const cup = await item("CUP-5OZ", "Paper cup 5 oz", "CUPS", "PC", "1.60", "2.20", "500", "100");
  const spoon = await item("SPN-STD", "Plastic spoon", "SPOONS", "PC", "0.30", "0.50", "500", "100");
  const sprinkle = await item("TOP-SPR", "Rainbow sprinkles", "TOPPINGS", "G", "0.25", "0.35", "1000", "200");

  const today = todayDate();
  for (const [it, q, c, batch] of [[van, "120", "320", "V-2611"], [choc, "50", "340", "C-2611"], [cone, "8000", "1.20", null], [cup, "2000", "1.60", null], [spoon, "2000", "0.30", null], [sprinkle, "10000", "0.25", null]] as const) {
    await receiveStock(wh, { itemId: it.id, quantity: q, unitCost: c, batchNo: batch, expiryDate: batch ? addDays(today, 120) : null, supplierRef: "DR-DEMO" });
  }
  await recordExpense(finance, { category: "INGREDIENT_PURCHASE", contactId: supplier.id, payeeName: supplier.name, description: "Opening stock purchase (demo)", billDate: addDays(today, -40), dueDate: addDays(today, -10), amount: "68000", paidNow: true, method: "BANK_TRANSFER" });

  const vanR = await saveRecipe(admin, { code: "VAN", name: "Vanilla mix", flavor: "Vanilla", yieldGrams: "3700", wastagePct: "5", isActive: true, ingredients: [{ itemId: van.id, name: "", quantity: "1", uom: "KG" }, { itemId: null, name: "Water", quantity: "2.7", uom: "L", unitCost: "0" }] });
  const chocR = await saveRecipe(admin, { code: "CHO", name: "Chocolate mix", flavor: "Chocolate", yieldGrams: "3700", wastagePct: "5", isActive: true, ingredients: [{ itemId: choc.id, name: "", quantity: "1", uom: "KG" }, { itemId: null, name: "Water", quantity: "2.7", uom: "L", unitCost: "0" }] });
  const products = [
    await saveProduct(admin, { code: "VC50", name: "Vanilla cone 50 g", type: "CONE", recipeId: vanR.id, servingGrams: "50", defaultPrice: "15", isActive: true, components: [{ itemId: cone.id, quantity: "1", uom: "PC" }] }),
    await saveProduct(admin, { code: "VC80", name: "Vanilla cone 80 g", type: "CONE", recipeId: vanR.id, servingGrams: "80", defaultPrice: "25", isActive: true, components: [{ itemId: cone.id, quantity: "1", uom: "PC" }] }),
    await saveProduct(admin, { code: "CC80", name: "Chocolate cone 80 g", type: "CONE", recipeId: chocR.id, servingGrams: "80", defaultPrice: "25", isActive: true, components: [{ itemId: cone.id, quantity: "1", uom: "PC" }] }),
    await saveProduct(admin, { code: "VCUP100", name: "Vanilla cup 100 g + sprinkles", type: "CUP", recipeId: vanR.id, servingGrams: "100", defaultPrice: "35", isActive: true, components: [{ itemId: cup.id, quantity: "1", uom: "PC" }, { itemId: spoon.id, quantity: "1", uom: "PC" }, { itemId: sprinkle.id, quantity: "5", uom: "G" }] }),
  ];

  const lastMonthStart = startOfMonth(addDays(startOfMonth(today), -1));
  const partnersDef = [
    { businessName: "Aling Nena's Store", ownerName: "Nena Santos", area: "Quezon City", pct: "50", custody: "PARTNER" as const },
    { businessName: "Kuya Ben Mini Mart", ownerName: "Benjamin Reyes", area: "Marikina", pct: "60", custody: "PARTNER" as const },
    { businessName: "Sunshine Canteen", ownerName: "Maria Cruz", area: "Pasig", pct: "40", custody: "OWNER" as const },
  ];
  let n = 0;
  for (const def of partnersDef) {
    n++;
    const p = await createPartner(admin, { businessName: def.businessName, ownerName: def.ownerName, area: def.area, contactNumber: `0917 555 000${n}`, address: `${n} Demo St., ${def.area}`, startDate: lastMonthStart });
    await changePartnerStatus(admin, p.id, "PENDING_APPROVAL", "Documents received");
    await createContract(admin, p.id, { effectiveFrom: lastMonthStart, shareModel: "PROFIT_SHARE", ownerSharePct: def.pct, fixedFee: "0", cogsBasis: "TRANSFER_PRICE", deductOperatingExpenses: true, shareLosses: true, cashCustody: def.custody, settlementFrequency: "MONTHLY", reportingMethod: "THEORETICAL", paymentTermsDays: 7, supplyPaymentTermsDays: 15, terms: "Demo agreement." });
    await changePartnerStatus(admin, p.id, "ACTIVE", "Approved");
    if (n === 2) await setProductPrice(admin, p.id, products[1].id, "28");
    const m = await createMachine(admin, { brand: "FrostLine", model: n === 3 ? "FL-1 Single" : "FL-3 Twin Twist", machineType: "Countertop", nozzles: n === 3 ? 1 : 3, serialNumber: `FL-DEMO-${1000 + n}`, purchaseDate: addDays(lastMonthStart, -30), purchasePrice: n === 3 ? "65000" : "95000", warrantyExpiry: addDays(today, 300), condition: "NEW", nextMaintenanceDate: addDays(today, 5 * n) });
    await assignMachine(admin, m.id, p.id, lastMonthStart, "Initial deployment");
    const user = await createUser(admin, { email: `partner${n}.demo@scoopmaster.local`, name: def.ownerName, password: "DemoPass123", role: "PARTNER", partnerId: p.id });
    const pa: Actor = { id: user.id, role: "PARTNER", partnerId: p.id };

    // Weekly supply orders (backdated to the delivery day — demo only), then daily sales
    const supplyOrders: string[] = [];
    const resupply = async (day: Date, initial: boolean) => {
      const so = await createSupplyRequest(pa, { partnerId: p.id, lines: [{ itemId: van.id, quantity: "6" }, { itemId: choc.id, quantity: "2" }, { itemId: cone.id, quantity: "400" }, { itemId: cup.id, quantity: "60" }, { itemId: spoon.id, quantity: "60" }, { itemId: sprinkle.id, quantity: "400" }] });
      await reviewSupplyOrder(admin, so.id, { approve: true, notes: initial ? "Initial supplies" : "Weekly replenishment" });
      await dispatchSupplyOrder(wh, so.id);
      await confirmSupplyReceipt(pa, so.id, { receivedQty: {} });
      await prisma.stockMovement.updateMany({ where: { sourceType: "SupplyOrder", sourceId: so.id }, data: { occurredAt: new Date(day.getTime() - 8 * 3600000 + 7 * 3600000) } });
      await prisma.invoice.updateMany({ where: { supplyOrderId: so.id }, data: { issueDate: day, dueDate: addDays(day, 15) } });
      supplyOrders.push(so.id);
    };
    for (let d = lastMonthStart; d < today; d = addDays(d, 1)) {
      if ((d.getTime() - lastMonthStart.getTime()) % (7 * 86400000) === 0) await resupply(d, d.getTime() === lastMonthStart.getTime());
      const seed = (d.getUTCDate() * 7 + n * 13) % 11;
      const q = [8 + seed, 14 + seed * 2, 6 + (seed % 5), 4 + (seed % 4)];
      const prices = [15, n === 2 ? 28 : 25, 25, 35];
      const gross = q.reduce((a, x, i) => a + x * prices[i], 0);
      const gcash = Math.round(gross * 0.3);
      const short = d.getUTCDate() === 12 ? 40 : 0;
      try {
        const r = await saveSalesReport(pa, { partnerId: p.id, reportDate: d, lines: products.map((pr, i) => ({ productId: pr.id, quantity: q[i], wastageQty: i === 1 && seed === 3 ? 1 : 0 })), discounts: "0", refunds: "0", cashSales: String(gross - gcash), gcashSales: String(gcash), otherSales: "0", actualCash: String(gross - gcash - short) }, { submit: true });
        if (d < addDays(today, -1)) await approveSalesReport(admin, r.id);
      } catch (e) { console.warn(`skip ${d.toISOString().slice(0, 10)}: ${(e as Error).message}`); }
    }
    const ex = await submitPartnerExpense(pa, { partnerId: p.id, expenseDate: addDays(lastMonthStart, 10), category: "Electricity", description: "Share of electric bill (machine)", amount: "650", paidBy: "PARTNER" });
    await reviewPartnerExpense(finance, ex.id, true);

    // Settle last month and collect part of it
    const s = await createSettlement(finance, { partnerId: p.id, periodStart: lastMonthStart, periodEnd: endOfMonth(lastMonthStart) });
    await submitSettlement(finance, s.id);
    await finalizeSettlement(admin, s.id);
    const inv = await prisma.invoice.findFirst({ where: { settlementId: s.id } });
    if (inv && n === 1) await recordPayment(finance, { direction: "IN", paymentDate: addDays(today, -2), amount: inv.amount.toString(), method: "GCASH", reference: "GC-DEMO-1", partyName: p.businessName, partnerId: p.id, allocations: [{ invoiceId: inv.id, amount: inv.amount.toString() }] });
    // Partners 1–2 pay older supply invoices; partner 3 leaves them open (shows overdue alerts)
    const supplyInvs = await prisma.invoice.findMany({ where: { supplyOrderId: { in: supplyOrders } }, orderBy: { issueDate: "asc" } });
    for (const si of n === 3 ? [] : supplyInvs.slice(0, -2)) await recordPayment(finance, { direction: "IN", paymentDate: addDays(si.issueDate, 10), amount: si.amount.toString(), method: "GCASH", reference: `GC-${si.number}`, partyName: p.businessName, partnerId: p.id, allocations: [{ invoiceId: si.id, amount: si.amount.toString() }] });
    if (n === 2) await reportMachineProblem(pa, { machineId: m.id, description: "Left nozzle dripping after cleaning." });
  }
  await prisma.machine.create({ data: { code: "MCH-0099", brand: "FrostLine", model: "FL-3 Twin Twist", nozzles: 3, serialNumber: "FL-DEMO-SPARE", purchasePrice: "95000", purchaseDate: addDays(today, -20), status: "AVAILABLE", condition: "NEW" } });
  await recordExpense(finance, { category: "DELIVERY", contactId: null, payeeName: "Demo Courier", description: "Supply deliveries", billDate: addDays(today, -3), dueDate: addDays(today, 10), amount: "1500", paidNow: false });
  console.log(`✔ Demo data loaded. Logins (password DemoPass123): admin.demo@ / finance.demo@ / warehouse.demo@ / ops.demo@ / partner1-3.demo@scoopmaster.local. Technician contact: ${tech.name}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
