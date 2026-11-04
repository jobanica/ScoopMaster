import { prisma, withTx } from "@/lib/db";
import { nextCode } from "@/lib/sequence";
import { audit } from "@/lib/audit";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { D, qty } from "@/lib/money";
import { addDays, todayDate } from "@/lib/dates";
import { UOM_LABEL } from "@/lib/units";
import type { Actor } from "../actor";
import { ensurePartnerLocation, getInTransit, getWarehouse, postMovement, postTransfer } from "./inventory";
import { createInvoice } from "./finance";
import { contractOn } from "./partners";
import { notify, notifyPartner } from "./notifications";

export async function createSupplyRequest(actor: Actor, input: { partnerId: string; notes?: string | null; lines: { itemId: string; quantity: string }[] }) {
  const partnerId = actor.role === "PARTNER" ? actor.partnerId! : input.partnerId;
  const lines = input.lines.filter((l) => l.quantity && D(l.quantity).gt(0));
  if (!lines.length) throw new AppError("Add at least one item with a quantity.");
  if (new Set(lines.map((l) => l.itemId)).size !== lines.length) throw new AppError("Each item can appear only once.");
  return withTx(async (tx) => {
    const partner = await tx.partner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new NotFoundError("Partner");
    if (!["ACTIVE", "PENDING_APPROVAL", "ON_HOLD"].includes(partner.status)) throw new AppError("Supply requests are only possible for active partners.");
    const items = await tx.inventoryItem.findMany({ where: { id: { in: lines.map((l) => l.itemId) }, isActive: true, isSellable: true } });
    if (items.length !== lines.length) throw new AppError("One or more items are not available for supply.");
    const byId = new Map(items.map((i) => [i.id, i]));
    const order = await tx.supplyOrder.create({
      data: {
        number: await nextCode(tx, "SO", 5), partnerId, notes: input.notes, requestedById: actor.id,
        lines: { create: lines.map((l) => ({ itemId: l.itemId, requestedQty: qty(l.quantity).toString(), unitPrice: byId.get(l.itemId)!.partnerPrice, unitCost: byId.get(l.itemId)!.avgCost })) },
      },
    });
    await audit(tx, { userId: actor.id, action: "SUPPLY_REQUEST", entityType: "SupplyOrder", entityId: order.id, after: { order, lines } });
    await notify("SUPPLY_REQUEST", { title: `Supply request ${order.number} from ${partner.businessName}`, body: `${lines.length} item(s)`, link: `/supply-orders/${order.id}`, dedupeKey: `so-${order.id}` }, tx);
    return order;
  });
}

/** Approve (with possibly adjusted quantities; 0 removes a line) or reject. Prices are snapshotted at approval. */
export async function reviewSupplyOrder(actor: Actor, orderId: string, input: { approve: boolean; notes?: string | null; approvedQty?: Record<string, string> }) {
  return withTx(async (tx) => {
    const order = await tx.supplyOrder.findUnique({ where: { id: orderId }, include: { lines: { include: { item: true } } } });
    if (!order) throw new NotFoundError("Supply order");
    if (order.status !== "REQUESTED") throw new AppError("Only new requests can be reviewed.");
    if (!input.approve) {
      if (!input.notes?.trim()) throw new AppError("Give a reason for rejecting the request.");
      await tx.supplyOrder.update({ where: { id: orderId }, data: { status: "REJECTED", reviewNotes: input.notes, approvedById: actor.id, approvedAt: new Date() } });
    } else {
      let any = false;
      for (const l of order.lines) {
        const a = qty(input.approvedQty?.[l.id] ?? l.requestedQty);
        if (a.isNegative()) throw new AppError("Approved quantities cannot be negative.");
        if (a.gt(0)) any = true;
        await tx.supplyOrderLine.update({ where: { id: l.id }, data: { approvedQty: a.toString(), unitPrice: l.item.partnerPrice } });
      }
      if (!any) throw new AppError("Approve at least one line, or reject the request.");
      await tx.supplyOrder.update({ where: { id: orderId }, data: { status: "APPROVED", reviewNotes: input.notes, approvedById: actor.id, approvedAt: new Date() } });
    }
    await audit(tx, { userId: actor.id, action: input.approve ? "SUPPLY_APPROVE" : "SUPPLY_REJECT", entityType: "SupplyOrder", entityId: orderId, summary: input.notes ?? undefined });
    await notifyPartner(order.partnerId, "SUPPLY_REQUEST", { title: `Supply request ${order.number} ${input.approve ? "approved" : "rejected"}`, body: input.notes ?? undefined, link: `/portal/supply-requests/${order.id}`, dedupeKey: `sorev-${order.id}` }, tx);
  });
}

export async function markPreparing(actor: Actor, orderId: string) {
  return withTx(async (tx) => {
    const o = await tx.supplyOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (o.status !== "APPROVED") throw new AppError("Only approved orders can be prepared.");
    await tx.supplyOrder.update({ where: { id: orderId }, data: { status: "PREPARING" } });
    await audit(tx, { userId: actor.id, action: "SUPPLY_PREPARE", entityType: "SupplyOrder", entityId: orderId });
  });
}

/** Dispatch: stock moves warehouse → in-transit (warehouse decreases now). Owner cost is snapshotted. */
export async function dispatchSupplyOrder(actor: Actor, orderId: string) {
  return withTx(async (tx) => {
    const o = await tx.supplyOrder.findUnique({ where: { id: orderId }, include: { lines: { include: { item: true } } } });
    if (!o) throw new NotFoundError("Supply order");
    if (!["APPROVED", "PREPARING"].includes(o.status)) throw new AppError("Only approved or preparing orders can be dispatched.");
    const wh = await getWarehouse(tx);
    const transit = await getInTransit(tx);
    for (const l of o.lines) {
      const q = D(l.approvedQty ?? 0);
      if (q.lte(0)) continue;
      const { out } = await postTransfer(tx, { itemId: l.itemId, fromId: wh.id, toId: transit.id, quantity: q, unitPrice: l.unitPrice, sourceType: "SupplyOrder", sourceId: o.id, reason: `Dispatch ${o.number}`, userId: actor.id });
      await tx.supplyOrderLine.update({ where: { id: l.id }, data: { unitCost: out.unitCost } });
    }
    await tx.supplyOrder.update({ where: { id: orderId }, data: { status: "DISPATCHED", dispatchedAt: new Date(), dispatchedById: actor.id } });
    await audit(tx, { userId: actor.id, action: "SUPPLY_DISPATCH", entityType: "SupplyOrder", entityId: orderId });
    await notifyPartner(o.partnerId, "SUPPLY_REQUEST", { title: `Order ${o.number} is on the way`, body: "Please confirm the quantities you receive.", link: `/portal/supply-requests/${o.id}`, dedupeKey: `sodisp-${o.id}` }, tx);
  });
}

/**
 * Receipt confirmation (partner or staff): in-transit → partner location for received quantities.
 * Shortfalls are written off from in-transit as DAMAGED. The supply invoice is generated for received goods only.
 */
export async function confirmSupplyReceipt(actor: Actor, orderId: string, input: { receivedQty: Record<string, string>; notes?: string | null }) {
  return withTx(async (tx) => {
    const o = await tx.supplyOrder.findUnique({ where: { id: orderId }, include: { lines: { include: { item: true } }, partner: true } });
    if (!o) throw new NotFoundError("Supply order");
    if (actor.role === "PARTNER" && o.partnerId !== actor.partnerId) throw new ForbiddenError();
    if (o.status !== "DISPATCHED") throw new AppError("Only dispatched orders can be received.");
    const transit = await getInTransit(tx);
    const loc = await ensurePartnerLocation(tx, o.partnerId);
    const invoiceLines: { description: string; itemId: string; quantity: string; unitPrice: string; unitCost: string }[] = [];
    for (const l of o.lines) {
      const sent = D(l.approvedQty ?? 0);
      if (sent.lte(0)) continue;
      const got = qty(input.receivedQty[l.id] ?? sent);
      if (got.isNegative() || got.gt(sent)) throw new AppError(`Received quantity for ${l.item.name} must be between 0 and ${sent.toString()}.`);
      if (got.gt(0)) {
        await postTransfer(tx, { itemId: l.itemId, fromId: transit.id, toId: loc.id, quantity: got, unitPrice: l.unitPrice, sourceType: "SupplyOrder", sourceId: o.id, reason: `Receipt ${o.number}`, userId: actor.id });
        invoiceLines.push({ description: `${l.item.name} (${UOM_LABEL[l.item.uom]})`, itemId: l.itemId, quantity: got.toString(), unitPrice: D(l.unitPrice).toString(), unitCost: D(l.unitCost).toString() });
      }
      const short = sent.minus(got);
      if (short.gt(0)) {
        await postMovement(tx, { type: "DAMAGED", itemId: l.itemId, locationId: transit.id, quantity: short.negated(), unitCost: l.unitCost, unitPrice: l.unitPrice, sourceType: "SupplyOrder", sourceId: o.id, reason: `Short delivery on ${o.number}${input.notes ? `: ${input.notes}` : ""}`, userId: actor.id });
      }
      await tx.supplyOrderLine.update({ where: { id: l.id }, data: { receivedQty: got.toString() } });
    }
    await tx.supplyOrder.update({ where: { id: orderId }, data: { status: "RECEIVED", receivedAt: new Date(), receivedById: actor.id, notes: input.notes ? `${o.notes ?? ""}\nReceipt: ${input.notes}`.trim() : o.notes } });
    let invoice = null;
    if (invoiceLines.length) {
      const today = todayDate();
      const contract = await contractOn(tx, o.partnerId, today);
      const terms = contract?.supplyPaymentTermsDays ?? 15;
      invoice = await createInvoice(actor, {
        type: "SUPPLY", partnerId: o.partnerId, description: `Supplies – order ${o.number}`, issueDate: today, dueDate: addDays(today, terms),
        paymentTerms: terms === 0 ? "Due on receipt" : `Net ${terms} days`, lines: invoiceLines, supplyOrderId: o.id,
      }, tx);
    }
    await audit(tx, { userId: actor.id, action: "SUPPLY_RECEIVE", entityType: "SupplyOrder", entityId: orderId, after: { receivedQty: input.receivedQty, invoiceId: invoice?.id } });
    return invoice;
  });
}

export async function cancelSupplyOrder(actor: Actor, orderId: string, reason: string) {
  if (!reason?.trim()) throw new AppError("A reason is required.");
  return withTx(async (tx) => {
    const o = await tx.supplyOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (actor.role === "PARTNER" && (o.partnerId !== actor.partnerId || o.status !== "REQUESTED")) throw new ForbiddenError("You can only cancel requests that have not been reviewed yet.");
    if (!["REQUESTED", "APPROVED", "PREPARING"].includes(o.status)) throw new AppError("Dispatched orders cannot be cancelled; confirm receipt with 0 quantities instead.");
    await tx.supplyOrder.update({ where: { id: orderId }, data: { status: "CANCELLED", reviewNotes: reason } });
    await audit(tx, { userId: actor.id, action: "SUPPLY_CANCEL", entityType: "SupplyOrder", entityId: orderId, summary: reason });
  });
}

export async function supplyMarkupSummary(from: Date, to: Date, partnerId?: string) {
  const invoices = await prisma.invoice.findMany({ where: { type: "SUPPLY", status: { not: "CANCELLED" }, issueDate: { gte: from, lte: to }, ...(partnerId ? { partnerId } : {}) } });
  const revenue = invoices.reduce((a, i) => a.plus(D(i.amount)), D(0));
  const cost = invoices.reduce((a, i) => a.plus(D(i.costAmount)), D(0));
  return { revenue, cost, markup: revenue.minus(cost), count: invoices.length };
}
