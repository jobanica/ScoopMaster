"use server";
import { requireUser } from "@/lib/auth";
import { safeAction } from "@/lib/action";
import { amount, bool, date, oneOf, optDate, optStr, str } from "@/lib/form";
import { AppError } from "@/lib/errors";
import { saveItem } from "@/server/services/catalog";
import { adjustStock, cancelStockCount, createStockCount, postStockCount, receiveStock, recordOutflow, returnToWarehouse, reverseMovement, saveCountLines, transferStock } from "@/server/services/inventory";

const CATS = ["ICE_CREAM_POWDER", "CONES", "CUPS", "SPOONS", "TOPPINGS", "SYRUPS", "PACKAGING", "CLEANING", "SPARE_PARTS", "OTHER"] as const;
const UOMS = ["KG", "G", "L", "ML", "PC", "BOX", "PACK", "BAG"] as const;

export const saveItemAction = safeAction(async (fd) => {
  const user = await requireUser("inventory:items");
  const id = optStr(fd, "id") ?? undefined;
  const item = await saveItem(user, {
    sku: str(fd, "sku", "SKU"), name: str(fd, "name", "Product name"), category: oneOf(fd, "category", CATS, "Category"), uom: oneOf(fd, "uom", UOMS, "Unit"),
    purchaseCost: amount(fd, "purchaseCost", "Purchase cost", { optional: true }), partnerPrice: amount(fd, "partnerPrice", "Selling price to partner", { optional: true }),
    minStock: amount(fd, "minStock", "Minimum stock", { optional: true }), partnerMinStock: amount(fd, "partnerMinStock", "Partner minimum", { optional: true }),
    supplierId: optStr(fd, "supplierId"), isPerishable: bool(fd, "isPerishable"), isSellable: bool(fd, "isSellable"), isActive: id ? bool(fd, "isActive") : true, notes: optStr(fd, "notes"),
  }, id);
  return id ? { revalidate: [`/inventory/items/${id}`], message: "Item saved." } : `/inventory/items/${item.id}`;
});

export const stockOperationAction = safeAction(async (fd) => {
  const user = await requireUser("inventory:write");
  const op = oneOf(fd, "op", ["RECEIPT", "ISSUE", "TRANSFER", "ADJUSTMENT", "RETURN", "DAMAGED", "EXPIRED", "RETURN_OUT"] as const, "Operation");
  const itemId = str(fd, "itemId", "Item");
  switch (op) {
    case "RECEIPT":
      await receiveStock(user, { itemId, quantity: amount(fd, "quantity", "Quantity"), unitCost: amount(fd, "unitCost", "Unit cost"), batchNo: optStr(fd, "batchNo"), expiryDate: optDate(fd, "expiryDate", "Expiry date"), supplierRef: optStr(fd, "reference"), locationId: optStr(fd, "locationId") ?? undefined });
      break;
    case "TRANSFER":
      await transferStock(user, { itemId, fromId: str(fd, "fromId", "From"), toId: str(fd, "toId", "To"), quantity: amount(fd, "quantity", "Quantity"), reason: optStr(fd, "reason") });
      break;
    case "ADJUSTMENT":
      await adjustStock(user, { itemId, locationId: str(fd, "locationId", "Location"), quantity: amount(fd, "quantity", "Quantity", { allowNegative: true }), reason: str(fd, "reason", "Reason") });
      break;
    case "RETURN":
      await returnToWarehouse(user, { itemId, fromLocationId: str(fd, "locationId", "Location"), quantity: amount(fd, "quantity", "Quantity"), reason: str(fd, "reason", "Reason") });
      break;
    default:
      await recordOutflow(user, { type: op, itemId, locationId: str(fd, "locationId", "Location"), quantity: amount(fd, "quantity", "Quantity"), reason: str(fd, "reason", "Reason") });
  }
  return { message: "Stock movement recorded.", revalidate: ["/inventory", "/inventory/movements"] };
});

export const reverseMovementAction = safeAction(async (fd) => {
  const user = await requireUser("inventory:write");
  await reverseMovement(user, str(fd, "id"), str(fd, "reason", "Reason"));
  return { revalidate: ["/inventory/movements"], message: "Movement reversed." };
});

export const createCountAction = safeAction(async (fd) => {
  const user = await requireUser("inventory:write");
  const c = await createStockCount(user, { locationId: str(fd, "locationId", "Location"), countDate: date(fd, "countDate", "Count date"), notes: optStr(fd, "notes") });
  return `/inventory/counts/${c.id}`;
});

export const saveCountAction = safeAction(async (fd) => {
  const user = await requireUser("inventory:write");
  const id = str(fd, "countId");
  const lines = fd.getAll("lineId").map(String).map((lineId) => {
    const v = optStr(fd, `counted_${lineId}`);
    if (v !== null && !/^\d+(\.\d+)?$/.test(v.replace(/,/g, ""))) throw new AppError("Counted quantities must be numbers.");
    return { lineId, countedQty: v === null ? null : v.replace(/,/g, ""), reason: optStr(fd, `reason_${lineId}`) };
  });
  await saveCountLines(user, id, lines);
  if (fd.get("intent") === "post") {
    const n = await postStockCount(user, id);
    return { revalidate: [`/inventory/counts/${id}`], message: `Count posted: ${n} variance movement(s) recorded.` };
  }
  return { revalidate: [`/inventory/counts/${id}`], message: "Count saved." };
});

export const cancelCountAction = safeAction(async (fd) => {
  const user = await requireUser("inventory:write");
  await cancelStockCount(user, str(fd, "id"));
  return "/inventory/counts";
});
