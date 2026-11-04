import { prisma } from "@/lib/db";
import { costProduct, costRecipe } from "@/lib/calc/recipe";

export async function recipeWithCosting(id: string) {
  const recipe = await prisma.recipe.findUnique({ where: { id }, include: { ingredients: { include: { item: true } }, products: { include: { components: { include: { item: true } } } } } });
  if (!recipe) return null;
  const owner = costRecipe(recipe, "OWNER_COST");
  const transfer = costRecipe(recipe, "TRANSFER_PRICE");
  const products = recipe.products.map((p) => ({ p, owner: costProduct({ servingGrams: p.servingGrams, price: p.defaultPrice, components: p.components }, owner, "OWNER_COST"), transfer: costProduct({ servingGrams: p.servingGrams, price: p.defaultPrice, components: p.components }, transfer, "TRANSFER_PRICE") }));
  return { recipe, owner, transfer, products };
}
