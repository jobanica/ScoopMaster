import type { ItemCategory, ProductType, Uom } from "@prisma/client";
import { withTx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import { D, money, qty } from "@/lib/money";
import { canConvert } from "@/lib/units";
import type { Actor } from "../actor";

export type ItemInput = {
  sku: string; name: string; category: ItemCategory; uom: Uom; purchaseCost: string; partnerPrice: string;
  minStock: string; partnerMinStock: string; supplierId?: string | null; isPerishable: boolean; isSellable: boolean; isActive: boolean; notes?: string | null;
};

export async function saveItem(actor: Actor, input: ItemInput, id?: string) {
  for (const [k, v] of [["Purchase cost", input.purchaseCost], ["Partner price", input.partnerPrice], ["Minimum stock", input.minStock], ["Partner minimum", input.partnerMinStock]] as const) {
    if (D(v || 0).isNegative()) throw new AppError(`${k} cannot be negative.`);
  }
  return withTx(async (tx) => {
    const sku = input.sku.trim().toUpperCase();
    const dup = await tx.inventoryItem.findFirst({ where: { sku, ...(id ? { NOT: { id } } : {}) } });
    if (dup) throw new AppError(`SKU ${sku} is already used by ${dup.name}.`);
    const before = id ? await tx.inventoryItem.findUnique({ where: { id } }) : null;
    if (id && !before) throw new NotFoundError("Item");
    if (before && before.uom !== input.uom) {
      const moved = await tx.stockMovement.count({ where: { itemId: id } });
      if (moved) throw new AppError("The unit of measure cannot change after stock movements exist. Create a new item instead.");
    }
    const data = {
      sku, name: input.name, category: input.category, uom: input.uom, purchaseCost: qty(input.purchaseCost || 0).toString(), partnerPrice: qty(input.partnerPrice || 0).toString(),
      minStock: qty(input.minStock || 0).toString(), partnerMinStock: qty(input.partnerMinStock || 0).toString(), supplierId: input.supplierId || null,
      isPerishable: input.isPerishable, isSellable: input.isSellable, isActive: input.isActive, notes: input.notes,
    };
    // avgCost is owned by the ledger (weighted average on receipts). Seed it from purchase cost for new items only.
    const item = id
      ? await tx.inventoryItem.update({ where: { id }, data: { ...data, ...(D(before!.avgCost).isZero() ? { avgCost: data.purchaseCost } : {}) } })
      : await tx.inventoryItem.create({ data: { ...data, avgCost: data.purchaseCost } });
    await audit(tx, { userId: actor.id, action: id ? "UPDATE" : "CREATE", entityType: "InventoryItem", entityId: item.id, before, after: item });
    return item;
  });
}

export type RecipeInput = {
  code: string; name: string; flavor?: string | null; yieldGrams: string; wastagePct: string; notes?: string | null; isActive: boolean;
  ingredients: { itemId: string | null; name: string; quantity: string; uom: Uom; unitCost?: string }[];
};

export async function saveRecipe(actor: Actor, input: RecipeInput, id?: string) {
  if (D(input.yieldGrams).lte(0)) throw new AppError("Expected yield must be greater than zero.");
  const w = D(input.wastagePct || 0);
  if (w.isNegative() || w.gte(100)) throw new AppError("Wastage must be between 0 and 99.99%.");
  const ings = input.ingredients.filter((i) => i.name.trim() || i.itemId);
  if (!ings.length) throw new AppError("Add at least one ingredient.");
  return withTx(async (tx) => {
    const code = input.code.trim().toUpperCase();
    const dup = await tx.recipe.findFirst({ where: { code, ...(id ? { NOT: { id } } : {}) } });
    if (dup) throw new AppError(`Recipe code ${code} already exists.`);
    const items = await tx.inventoryItem.findMany({ where: { id: { in: ings.map((i) => i.itemId).filter(Boolean) as string[] } } });
    const byId = new Map(items.map((i) => [i.id, i]));
    const rows = ings.map((i) => {
      if (D(i.quantity).lte(0)) throw new AppError(`Quantity for ${i.name || "ingredient"} must be greater than zero.`);
      const item = i.itemId ? byId.get(i.itemId) : null;
      if (i.itemId && !item) throw new AppError("Unknown inventory item in recipe.");
      if (item && !canConvert(i.uom, item.uom)) throw new AppError(`${item.name} is stocked in ${item.uom}; the recipe unit ${i.uom} is not convertible.`);
      return { itemId: item?.id ?? null, name: item?.name ?? i.name.trim(), quantity: qty(i.quantity).toString(), uom: i.uom, unitCost: item ? "0" : qty(i.unitCost || 0).toString() };
    });
    const before = id ? await tx.recipe.findUnique({ where: { id }, include: { ingredients: true } }) : null;
    const data = { code, name: input.name, flavor: input.flavor, yieldGrams: money(input.yieldGrams).toString(), wastagePct: money(input.wastagePct || 0).toString(), notes: input.notes, isActive: input.isActive };
    let recipe;
    if (id) {
      await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
      recipe = await tx.recipe.update({ where: { id }, data: { ...data, ingredients: { create: rows } } });
    } else {
      recipe = await tx.recipe.create({ data: { ...data, ingredients: { create: rows } } });
    }
    await audit(tx, { userId: actor.id, action: id ? "UPDATE" : "CREATE", entityType: "Recipe", entityId: recipe.id, before, after: { ...recipe, ingredients: rows } });
    return recipe;
  });
}

export type ProductInput = {
  code: string; name: string; type: ProductType; recipeId?: string | null; servingGrams: string; defaultPrice: string; isActive: boolean;
  components: { itemId: string; quantity: string; uom: Uom }[];
};

export async function saveProduct(actor: Actor, input: ProductInput, id?: string) {
  if (D(input.defaultPrice).isNegative()) throw new AppError("Price cannot be negative.");
  if (D(input.servingGrams || 0).isNegative()) throw new AppError("Serving size cannot be negative.");
  if (input.recipeId && D(input.servingGrams || 0).lte(0)) throw new AppError("Products made from a recipe need a serving size in grams.");
  return withTx(async (tx) => {
    const code = input.code.trim().toUpperCase();
    const dup = await tx.product.findFirst({ where: { code, ...(id ? { NOT: { id } } : {}) } });
    if (dup) throw new AppError(`Product code ${code} already exists.`);
    const comps = input.components.filter((c) => c.itemId && c.quantity);
    const items = await tx.inventoryItem.findMany({ where: { id: { in: comps.map((c) => c.itemId) } } });
    const byId = new Map(items.map((i) => [i.id, i]));
    const rows = comps.map((c) => {
      const item = byId.get(c.itemId);
      if (!item) throw new AppError("Unknown component item.");
      if (D(c.quantity).lte(0)) throw new AppError(`Quantity for ${item.name} must be greater than zero.`);
      if (!canConvert(c.uom, item.uom)) throw new AppError(`${item.name} is stocked in ${item.uom}; ${c.uom} is not convertible.`);
      return { itemId: item.id, quantity: qty(c.quantity).toString(), uom: c.uom };
    });
    const before = id ? await tx.product.findUnique({ where: { id }, include: { components: true } }) : null;
    const data = { code, name: input.name, type: input.type, recipeId: input.recipeId || null, servingGrams: money(input.servingGrams || 0).toString(), defaultPrice: money(input.defaultPrice).toString(), isActive: input.isActive };
    let product;
    if (id) {
      await tx.productComponent.deleteMany({ where: { productId: id } });
      product = await tx.product.update({ where: { id }, data: { ...data, components: { create: rows } } });
    } else {
      product = await tx.product.create({ data: { ...data, components: { create: rows } } });
    }
    await audit(tx, { userId: actor.id, action: id ? "UPDATE" : "CREATE", entityType: "Product", entityId: product.id, before, after: { ...product, components: rows } });
    return product;
  });
}
