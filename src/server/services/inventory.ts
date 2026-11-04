import crypto from "node:crypto";
import type { MovementType, Prisma } from "@prisma/client";
import { prisma, withTx, type Tx } from "@/lib/db";
import { D, qty, type DecimalLike, Decimal } from "@/lib/money";
import { nextCode } from "@/lib/sequence";
import { audit } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import { weightedAverageCost } from "@/lib/calc/inventory";
import { manilaDayStart, todayDate } from "@/lib/dates";
import type { Actor } from "../actor";
import { assertPeriodOpenForLocation } from "./periods";

export const WAREHOUSE_CODE = "WH-MAIN";
export const IN_TRANSIT_CODE = "IN-TRANSIT";

/** Movement types that may drive a partner location below zero (theoretical usage; corrected by counts). */
const MAY_GO_NEGATIVE: MovementType[] = ["CONSUMPTION", "WASTAGE"];

export async function getWarehouse(db: Tx | typeof prisma = prisma) {
  const wh = await db.location.findUnique({ where: { code: WAREHOUSE_CODE } });
  if (!wh) throw new AppError("Main warehouse is not configured. Run the database seed.");
  return wh;
}

export async function getInTransit(db: Tx | typeof prisma = prisma) {
  const loc = await db.location.findUnique({ where: { code: IN_TRANSIT_CODE } });
  if (!loc) throw new AppError("In-transit location is not configured. Run the database seed.");
  return loc;
}

export async function ensurePartnerLocation(tx: Tx, partnerId: string) {
  const existing = await tx.location.findUnique({ where: { partnerId } });
  if (existing) return existing;
  const p = await tx.partner.findUniqueOrThrow({ where: { id: partnerId } });
  return tx.location.create({ data: { code: `LOC-${p.code}`, name: p.businessName, type: "PARTNER", partnerId, address: p.address } });
}

export type MovementInput = {
  type: MovementType;
  itemId: string;
  locationId: string;
  quantity: DecimalLike; // signed
  unitCost?: DecimalLike;
  unitPrice?: DecimalLike;
  batch?: { batchNo: string; expiryDate?: Date | null } | null;
  sourceType?: string;
  sourceId?: string;
  reason?: string | null;
  groupId?: string;
  occurredAt?: Date;
  reversesId?: string;
  userId?: string | null;
};

/**
 * The ONLY way stock levels change. Writes an immutable StockMovement and updates the StockLevel atomically.
 * Must be called inside a transaction.
 */
export async function postMovement(tx: Tx, m: MovementInput) {
  const q = qty(m.quantity);
  if (q.isZero()) throw new AppError("Movement quantity cannot be zero.");
  const item = await tx.inventoryItem.findUnique({ where: { id: m.itemId } });
  if (!item) throw new NotFoundError("Inventory item");
  const location = await tx.location.findUnique({ where: { id: m.locationId } });
  if (!location) throw new NotFoundError("Location");

  // Atomic upsert-increment; row is locked for the rest of the transaction.
  const rows = await tx.$queryRaw<{ quantity: Prisma.Decimal }[]>`
    INSERT INTO "StockLevel" ("id", "itemId", "locationId", "quantity", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${m.itemId}, ${m.locationId}, ${q.toString()}::numeric, NOW())
    ON CONFLICT ("itemId", "locationId")
    DO UPDATE SET "quantity" = "StockLevel"."quantity" + EXCLUDED."quantity", "updatedAt" = NOW()
    RETURNING "quantity"`;
  const balanceAfter = D(rows[0].quantity);
  const canGoNegative = MAY_GO_NEGATIVE.includes(m.type) && location.type === "PARTNER";
  if (balanceAfter.isNegative() && !canGoNegative && m.type !== "REVERSAL") {
    throw new AppError(`Insufficient stock of ${item.name} at ${location.name}: available ${balanceAfter.minus(q).toString()}, requested ${q.abs().toString()}.`);
  }

  // Weighted-average costing on purchases received into a warehouse.
  if (m.type === "RECEIPT" && location.type === "WAREHOUSE") {
    const onHandBefore = await tx.stockLevel.aggregate({ where: { itemId: item.id, location: { type: "WAREHOUSE" } }, _sum: { quantity: true } });
    const before = D(onHandBefore._sum.quantity).minus(q);
    const newAvg = weightedAverageCost(before, item.avgCost, q, m.unitCost ?? item.purchaseCost);
    await tx.inventoryItem.update({ where: { id: item.id }, data: { avgCost: newAvg.toString(), purchaseCost: D(m.unitCost ?? item.purchaseCost).toString() } });
  }

  // Batch tracking: inflow with batch info creates/increments the batch; outflows consume batches FEFO.
  let batchId: string | null = null;
  if (q.isPositive() && m.batch?.batchNo) {
    const b = await tx.stockBatch.upsert({
      where: { itemId_locationId_batchNo: { itemId: item.id, locationId: location.id, batchNo: m.batch.batchNo } },
      create: { itemId: item.id, locationId: location.id, batchNo: m.batch.batchNo, expiryDate: m.batch.expiryDate ?? null, quantity: q.toString() },
      update: { quantity: { increment: q.toString() } },
    });
    batchId = b.id;
  } else if (q.isNegative()) {
    let remaining = q.abs();
    const batches = await tx.stockBatch.findMany({
      where: { itemId: item.id, locationId: location.id, quantity: { gt: 0 } },
      orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    });
    for (const b of batches) {
      if (remaining.lte(0)) break;
      const take = Decimal.min(remaining, D(b.quantity));
      await tx.stockBatch.update({ where: { id: b.id }, data: { quantity: { decrement: take.toString() } } });
      if (!batchId) batchId = b.id;
      remaining = remaining.minus(take);
    }
  }

  const freshItem = m.type === "RECEIPT" ? await tx.inventoryItem.findUniqueOrThrow({ where: { id: item.id } }) : item;
  return tx.stockMovement.create({
    data: {
      number: await nextCode(tx, "MV", 7),
      type: m.type,
      itemId: item.id,
      locationId: location.id,
      quantity: q.toString(),
      unitCost: qty(m.unitCost ?? freshItem.avgCost).toString(),
      unitPrice: qty(m.unitPrice ?? freshItem.partnerPrice).toString(),
      balanceAfter: balanceAfter.toString(),
      batchId,
      groupId: m.groupId,
      sourceType: m.sourceType ?? "Manual",
      sourceId: m.sourceId,
      reason: m.reason ?? null,
      reversesId: m.reversesId,
      createdById: m.userId ?? null,
      occurredAt: m.occurredAt ?? new Date(),
    },
  });
}

/** Transfer between two locations: paired TRANSFER_OUT / TRANSFER_IN movements sharing a groupId. */
export async function postTransfer(
  tx: Tx,
  t: { itemId: string; fromId: string; toId: string; quantity: DecimalLike; unitPrice?: DecimalLike; sourceType?: string; sourceId?: string; reason?: string | null; userId?: string | null; occurredAt?: Date },
) {
  const q = qty(t.quantity);
  if (q.lte(0)) throw new AppError("Transfer quantity must be greater than zero.");
  if (t.fromId === t.toId) throw new AppError("Source and destination must differ.");
  const groupId = crypto.randomUUID();
  const out = await postMovement(tx, { type: "TRANSFER_OUT", itemId: t.itemId, locationId: t.fromId, quantity: q.negated(), unitPrice: t.unitPrice, groupId, sourceType: t.sourceType, sourceId: t.sourceId, reason: t.reason, userId: t.userId, occurredAt: t.occurredAt });
  const inn = await postMovement(tx, { type: "TRANSFER_IN", itemId: t.itemId, locationId: t.toId, quantity: q, unitCost: out.unitCost, unitPrice: t.unitPrice ?? out.unitPrice, groupId, sourceType: t.sourceType, sourceId: t.sourceId, reason: t.reason, userId: t.userId, occurredAt: t.occurredAt });
  return { out, in: inn };
}

// ───────────── User-facing stock operations (each audited) ─────────────

export async function receiveStock(actor: Actor, input: { itemId: string; quantity: DecimalLike; unitCost: DecimalLike; batchNo?: string | null; expiryDate?: Date | null; supplierRef?: string | null; locationId?: string }) {
  return withTx(async (tx) => {
    const loc = input.locationId ? await tx.location.findUniqueOrThrow({ where: { id: input.locationId } }) : await getWarehouse(tx);
    if (loc.type !== "WAREHOUSE") throw new AppError("Purchases can only be received into a warehouse.");
    if (D(input.quantity).lte(0)) throw new AppError("Quantity must be greater than zero.");
    if (D(input.unitCost).isNegative()) throw new AppError("Unit cost cannot be negative.");
    const mv = await postMovement(tx, {
      type: "RECEIPT", itemId: input.itemId, locationId: loc.id, quantity: input.quantity, unitCost: input.unitCost,
      batch: input.batchNo ? { batchNo: input.batchNo, expiryDate: input.expiryDate } : null,
      reason: input.supplierRef ? `Supplier ref: ${input.supplierRef}` : "Stock received", userId: actor.id,
    });
    await audit(tx, { userId: actor.id, action: "STOCK_RECEIVE", entityType: "StockMovement", entityId: mv.id, after: mv });
    return mv;
  });
}

const OUTFLOW_TYPES = ["ISSUE", "DAMAGED", "EXPIRED", "RETURN_OUT"] as const;
export type OutflowType = (typeof OUTFLOW_TYPES)[number];

export async function recordOutflow(actor: Actor, input: { type: OutflowType; itemId: string; locationId: string; quantity: DecimalLike; reason: string }) {
  if (!OUTFLOW_TYPES.includes(input.type)) throw new AppError("Invalid movement type.");
  if (!input.reason?.trim()) throw new AppError("A reason is required.");
  if (D(input.quantity).lte(0)) throw new AppError("Quantity must be greater than zero.");
  return withTx(async (tx) => {
    await assertPeriodOpenForLocation(tx, input.locationId, todayDate());
    const mv = await postMovement(tx, { type: input.type, itemId: input.itemId, locationId: input.locationId, quantity: D(input.quantity).negated(), reason: input.reason, userId: actor.id });
    await audit(tx, { userId: actor.id, action: `STOCK_${input.type}`, entityType: "StockMovement", entityId: mv.id, after: mv });
    return mv;
  });
}

export async function returnToWarehouse(actor: Actor, input: { itemId: string; fromLocationId: string; quantity: DecimalLike; reason: string }) {
  if (!input.reason?.trim()) throw new AppError("A reason is required.");
  return withTx(async (tx) => {
    const wh = await getWarehouse(tx);
    await assertPeriodOpenForLocation(tx, input.fromLocationId, todayDate());
    const groupId = crypto.randomUUID();
    const q = qty(input.quantity);
    if (q.lte(0)) throw new AppError("Quantity must be greater than zero.");
    const out = await postMovement(tx, { type: "RETURN_OUT", itemId: input.itemId, locationId: input.fromLocationId, quantity: q.negated(), groupId, reason: input.reason, userId: actor.id, sourceType: "Return" });
    const inn = await postMovement(tx, { type: "RETURN_IN", itemId: input.itemId, locationId: wh.id, quantity: q, unitCost: out.unitCost, groupId, reason: input.reason, userId: actor.id, sourceType: "Return" });
    await audit(tx, { userId: actor.id, action: "STOCK_RETURN", entityType: "StockMovement", entityId: inn.id, after: { out, in: inn } });
    return inn;
  });
}

export async function transferStock(actor: Actor, input: { itemId: string; fromId: string; toId: string; quantity: DecimalLike; reason?: string | null }) {
  return withTx(async (tx) => {
    await assertPeriodOpenForLocation(tx, input.fromId, todayDate());
    await assertPeriodOpenForLocation(tx, input.toId, todayDate());
    const r = await postTransfer(tx, { ...input, userId: actor.id, sourceType: "Manual" });
    await audit(tx, { userId: actor.id, action: "STOCK_TRANSFER", entityType: "StockMovement", entityId: r.out.id, after: r });
    return r;
  });
}

export async function adjustStock(actor: Actor, input: { itemId: string; locationId: string; quantity: DecimalLike; reason: string }) {
  if (!input.reason?.trim()) throw new AppError("Adjustments require a reason.");
  return withTx(async (tx) => {
    await assertPeriodOpenForLocation(tx, input.locationId, todayDate());
    const mv = await postMovement(tx, { type: "ADJUSTMENT", itemId: input.itemId, locationId: input.locationId, quantity: input.quantity, reason: input.reason, userId: actor.id });
    await audit(tx, { userId: actor.id, action: "STOCK_ADJUST", entityType: "StockMovement", entityId: mv.id, summary: input.reason, after: mv });
    return mv;
  });
}

/** Reverses a movement with an equal and opposite REVERSAL movement (never deletes). */
export async function reverseMovement(actor: Actor, movementId: string, reason: string) {
  if (!reason?.trim()) throw new AppError("A reason is required to reverse a movement.");
  return withTx(async (tx) => {
    const mv = await tx.stockMovement.findUnique({ where: { id: movementId }, include: { reversedBy: true } });
    if (!mv) throw new NotFoundError("Movement");
    if (mv.reversedBy) throw new AppError("This movement has already been reversed.");
    if (mv.type === "REVERSAL") throw new AppError("A reversal cannot be reversed; post a new movement instead.");
    if (mv.groupId) throw new AppError("Paired transfer movements must be corrected with a new transfer in the opposite direction.");
    if (mv.sourceType && !["Manual"].includes(mv.sourceType)) throw new AppError(`This movement was generated by ${mv.sourceType}; correct it from the source document.`);
    await assertPeriodOpenForLocation(tx, mv.locationId, todayDate());
    const rev = await postMovement(tx, {
      type: "REVERSAL", itemId: mv.itemId, locationId: mv.locationId, quantity: D(mv.quantity).negated(), unitCost: mv.unitCost, unitPrice: mv.unitPrice,
      reason, reversesId: mv.id, sourceType: "Manual", userId: actor.id,
    });
    const after = await tx.stockLevel.findUniqueOrThrow({ where: { itemId_locationId: { itemId: mv.itemId, locationId: mv.locationId } } });
    const loc = await tx.location.findUniqueOrThrow({ where: { id: mv.locationId } });
    if (D(after.quantity).isNegative() && loc.type !== "PARTNER") throw new AppError("Reversal would make stock negative.");
    await audit(tx, { userId: actor.id, action: "STOCK_REVERSE", entityType: "StockMovement", entityId: mv.id, summary: reason, after: rev });
    return rev;
  });
}

// ───────────── Physical counts ─────────────

export async function createStockCount(actor: Actor, input: { locationId: string; countDate: Date; notes?: string | null; categoryOnly?: string | null }) {
  return withTx(async (tx) => {
    const open = await tx.stockCount.findFirst({ where: { locationId: input.locationId, status: "DRAFT" } });
    if (open) throw new AppError(`Count ${open.number} is still open for this location. Post or cancel it first.`);
    const items = await tx.inventoryItem.findMany({ where: { isActive: true }, orderBy: [{ category: "asc" }, { name: "asc" }] });
    const levels = await tx.stockLevel.findMany({ where: { locationId: input.locationId } });
    const byItem = new Map(levels.map((l) => [l.itemId, l.quantity]));
    const count = await tx.stockCount.create({
      data: {
        number: await nextCode(tx, "CNT", 5), locationId: input.locationId, countDate: input.countDate, notes: input.notes, createdById: actor.id,
        lines: { create: items.map((i) => ({ itemId: i.id, systemQty: (byItem.get(i.id) ?? 0).toString() })) },
      },
    });
    await audit(tx, { userId: actor.id, action: "COUNT_CREATE", entityType: "StockCount", entityId: count.id });
    return count;
  });
}

export async function saveCountLines(actor: Actor, countId: string, lines: { lineId: string; countedQty: string | null; reason?: string | null }[]) {
  return withTx(async (tx) => {
    const count = await tx.stockCount.findUniqueOrThrow({ where: { id: countId } });
    if (count.status !== "DRAFT") throw new AppError("Only draft counts can be edited.");
    for (const l of lines) {
      if (l.countedQty !== null && (D(l.countedQty).isNegative())) throw new AppError("Counted quantities cannot be negative.");
      await tx.stockCountLine.update({ where: { id: l.lineId, countId }, data: { countedQty: l.countedQty === null ? null : qty(l.countedQty).toString(), reason: l.reason ?? null } });
    }
    await audit(tx, { userId: actor.id, action: "COUNT_UPDATE", entityType: "StockCount", entityId: countId });
  });
}

/** Posts COUNT_VARIANCE movements so the ledger matches the physical count (variance vs the CURRENT system qty). */
export async function postStockCount(actor: Actor, countId: string) {
  return withTx(async (tx) => {
    const count = await tx.stockCount.findUniqueOrThrow({ where: { id: countId }, include: { lines: true } });
    if (count.status !== "DRAFT") throw new AppError("Count is not a draft.");
    await assertPeriodOpenForLocation(tx, count.locationId, count.countDate);
    let posted = 0;
    for (const line of count.lines) {
      if (line.countedQty === null) continue;
      const level = await tx.stockLevel.findUnique({ where: { itemId_locationId: { itemId: line.itemId, locationId: count.locationId } } });
      const variance = D(line.countedQty).minus(D(level?.quantity));
      if (variance.isZero()) continue;
      await postMovement(tx, {
        type: "COUNT_VARIANCE", itemId: line.itemId, locationId: count.locationId, quantity: variance, sourceType: "StockCount", sourceId: count.id,
        reason: line.reason || `Physical count ${count.number}`, userId: actor.id, occurredAt: new Date(manilaDayStart(count.countDate).getTime() + 20 * 3600000),
      });
      posted++;
    }
    await tx.stockCount.update({ where: { id: countId }, data: { status: "POSTED", postedAt: new Date(), postedById: actor.id } });
    await audit(tx, { userId: actor.id, action: "COUNT_POST", entityType: "StockCount", entityId: countId, summary: `${posted} variance movement(s)` });
    return posted;
  });
}

export async function cancelStockCount(actor: Actor, countId: string) {
  return withTx(async (tx) => {
    const c = await tx.stockCount.findUniqueOrThrow({ where: { id: countId } });
    if (c.status !== "DRAFT") throw new AppError("Only draft counts can be cancelled.");
    await tx.stockCount.update({ where: { id: countId }, data: { status: "CANCELLED" } });
    await audit(tx, { userId: actor.id, action: "COUNT_CANCEL", entityType: "StockCount", entityId: countId });
  });
}

// ───────────── Queries ─────────────

export async function inventoryValuation(locationId?: string) {
  const levels = await prisma.stockLevel.findMany({
    where: { ...(locationId ? { locationId } : {}), quantity: { not: 0 } },
    include: { item: true, location: true },
  });
  return levels.map((l) => ({
    itemId: l.itemId, sku: l.item.sku, name: l.item.name, category: l.item.category, uom: l.item.uom,
    locationId: l.locationId, location: l.location.name, locationType: l.location.type,
    quantity: D(l.quantity), avgCost: D(l.item.avgCost), partnerPrice: D(l.item.partnerPrice),
    costValue: D(l.quantity).times(D(l.item.avgCost)), priceValue: D(l.quantity).times(D(l.item.partnerPrice)),
    minStock: D(l.location.type === "WAREHOUSE" ? l.item.minStock : l.item.partnerMinStock),
  }));
}

export async function lowStockItems() {
  const items = await prisma.inventoryItem.findMany({ where: { isActive: true, minStock: { gt: 0 } }, include: { stockLevels: { include: { location: true } } } });
  return items
    .map((i) => ({ item: i, onHand: i.stockLevels.filter((s) => s.location.type === "WAREHOUSE").reduce((a, s) => a.plus(D(s.quantity)), new Decimal(0)) }))
    .filter((r) => r.onHand.lte(D(r.item.minStock)));
}

export async function partnerLowStock() {
  const levels = await prisma.stockLevel.findMany({
    where: { location: { type: "PARTNER", isActive: true }, item: { partnerMinStock: { gt: 0 }, isActive: true } },
    include: { item: true, location: true },
  });
  return levels.filter((l) => D(l.quantity).lte(D(l.item.partnerMinStock)));
}
