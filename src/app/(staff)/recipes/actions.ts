"use server";
import { requireUser } from "@/lib/auth";
import { safeAction } from "@/lib/action";
import { amount, bool, oneOf, optStr, str } from "@/lib/form";
import { saveProduct, saveRecipe } from "@/server/services/catalog";

type Uom = "KG" | "G" | "L" | "ML" | "PC" | "BOX" | "PACK" | "BAG";

export const saveRecipeAction = safeAction(async (fd) => {
  const user = await requireUser("recipes:write");
  const id = optStr(fd, "id") ?? undefined;
  const rows = fd.getAll("row").map(String);
  const ingredients = rows.map((r) => ({
    itemId: optStr(fd, `item_${r}`), name: optStr(fd, `name_${r}`) ?? "", quantity: optStr(fd, `qty_${r}`) ?? "",
    uom: (optStr(fd, `uom_${r}`) ?? "KG") as Uom, unitCost: optStr(fd, `cost_${r}`) ?? "0",
  })).filter((i) => (i.itemId || i.name) && i.quantity);
  const r = await saveRecipe(user, {
    code: str(fd, "code", "Code"), name: str(fd, "name", "Name"), flavor: optStr(fd, "flavor"), yieldGrams: amount(fd, "yieldGrams", "Expected yield"),
    wastagePct: amount(fd, "wastagePct", "Wastage %", { optional: true }), notes: optStr(fd, "notes"), isActive: id ? bool(fd, "isActive") : true, ingredients,
  }, id);
  return id ? { revalidate: [`/recipes/${id}`], message: "Recipe saved." } : `/recipes/${r.id}`;
});

export const saveProductAction = safeAction(async (fd) => {
  const user = await requireUser("recipes:write");
  const id = optStr(fd, "id") ?? undefined;
  const rows = fd.getAll("row").map(String);
  const components = rows.map((r) => ({ itemId: optStr(fd, `item_${r}`) ?? "", quantity: optStr(fd, `qty_${r}`) ?? "", uom: (optStr(fd, `uom_${r}`) ?? "PC") as Uom })).filter((c) => c.itemId && c.quantity);
  const p = await saveProduct(user, {
    code: str(fd, "code", "Code"), name: str(fd, "name", "Name"), type: oneOf(fd, "type", ["CONE", "CUP", "OTHER"] as const), recipeId: optStr(fd, "recipeId"),
    servingGrams: amount(fd, "servingGrams", "Serving size", { optional: true }), defaultPrice: amount(fd, "defaultPrice", "Default price"), isActive: id ? bool(fd, "isActive") : true, components,
  }, id);
  return id ? { revalidate: [`/recipes/products/${id}`], message: "Product saved." } : `/recipes/products/${p.id}`;
});
