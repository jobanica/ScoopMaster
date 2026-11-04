import type { Uom } from "@prisma/client";
import { D, sum, type DecimalLike, Decimal } from "../money";
import { canConvert, convertQty } from "../units";

export type CostItem = { id: string; uom: Uom; avgCost: DecimalLike; partnerPrice: DecimalLike };
export type CostBasis = "OWNER_COST" | "TRANSFER_PRICE";

export type RecipeInput = {
  yieldGrams: DecimalLike;
  wastagePct: DecimalLike;
  ingredients: { itemId: string | null; name: string; quantity: DecimalLike; uom: Uom; unitCost?: DecimalLike; item?: CostItem | null }[];
};

export type ProductInput = {
  servingGrams: DecimalLike;
  price: DecimalLike;
  components: { itemId: string; quantity: DecimalLike; uom: Uom; item: CostItem }[];
};

function unitCostOf(item: CostItem, basis: CostBasis): Decimal {
  return D(basis === "OWNER_COST" ? item.avgCost : item.partnerPrice);
}

export function costRecipe(r: RecipeInput, basis: CostBasis = "OWNER_COST") {
  const yieldGrams = D(r.yieldGrams);
  if (yieldGrams.lte(0)) throw new Error("Recipe yield must be greater than zero.");
  const wastage = D(r.wastagePct).dividedBy(100);
  if (wastage.isNegative() || wastage.gte(1)) throw new Error("Wastage must be between 0% and 99.99%.");
  const lines = r.ingredients.map((ing) => {
    let cost: Decimal;
    if (ing.item) {
      if (!canConvert(ing.uom, ing.item.uom)) throw new Error(`Ingredient ${ing.name}: cannot convert ${ing.uom} to ${ing.item.uom}`);
      cost = convertQty(ing.quantity, ing.uom, ing.item.uom).times(unitCostOf(ing.item, basis));
    } else {
      cost = D(ing.quantity).times(D(ing.unitCost));
    }
    return { name: ing.name, cost };
  });
  const batchCost = sum(lines.map((l) => l.cost));
  const costPerGram = batchCost.dividedBy(yieldGrams);
  const effectiveCostPerGram = costPerGram.dividedBy(new Decimal(1).minus(wastage));
  return {
    lines,
    batchCost,
    costPerKg: costPerGram.times(1000),
    costPerGram,
    effectiveCostPerGram, // includes the wastage assumption
    usableGrams: yieldGrams.times(new Decimal(1).minus(wastage)),
    yieldGrams,
    wastage,
  };
}

export function costProduct(p: ProductInput, recipe: ReturnType<typeof costRecipe> | null, basis: CostBasis = "OWNER_COST") {
  const serving = D(p.servingGrams);
  const mixCost = recipe ? serving.times(recipe.effectiveCostPerGram) : new Decimal(0);
  const componentCost = sum(
    p.components.map((c) => convertQty(c.quantity, c.uom, c.item.uom).times(unitCostOf(c.item, basis))),
  );
  const unitCost = mixCost.plus(componentCost);
  const price = D(p.price);
  const theoreticalServings = recipe && serving.gt(0) ? recipe.yieldGrams.dividedBy(serving).floor() : new Decimal(0);
  const expectedServings = recipe && serving.gt(0) ? recipe.usableGrams.dividedBy(serving).floor() : new Decimal(0);
  return {
    mixCost,
    componentCost,
    unitCost,
    price,
    grossProfit: price.minus(unitCost),
    marginPct: price.gt(0) ? price.minus(unitCost).dividedBy(price).times(100) : new Decimal(0),
    theoreticalServings, // ignores wastage
    expectedServings, // after wastage assumption
    expectedRevenuePerBatch: expectedServings.times(price),
    expectedProfitPerBatch: expectedServings.times(price).minus(recipe ? recipe.batchCost : 0).minus(expectedServings.times(componentCost)),
  };
}

/**
 * Theoretical inventory consumption for ONE unit of a product, in each item's own unit of measure.
 * Uses the exact serving (no wastage factor); actual wastage is tracked separately.
 */
export function consumptionPerUnit(
  product: { servingGrams: DecimalLike; components: { itemId: string; quantity: DecimalLike; uom: Uom; item: { uom: Uom } }[] },
  recipe: { yieldGrams: DecimalLike; ingredients: { itemId: string | null; quantity: DecimalLike; uom: Uom; item?: { uom: Uom } | null }[] } | null,
): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  const add = (id: string, q: Decimal) => out.set(id, (out.get(id) ?? new Decimal(0)).plus(q));
  if (recipe && D(product.servingGrams).gt(0)) {
    const ratio = D(product.servingGrams).dividedBy(D(recipe.yieldGrams));
    for (const ing of recipe.ingredients) {
      if (!ing.itemId || !ing.item) continue;
      add(ing.itemId, convertQty(ing.quantity, ing.uom, ing.item.uom).times(ratio));
    }
  }
  for (const c of product.components) add(c.itemId, convertQty(c.quantity, c.uom, c.item.uom));
  return out;
}
