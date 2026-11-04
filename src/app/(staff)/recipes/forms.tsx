import type { Product, ProductComponent, Recipe, RecipeIngredient, InventoryItem } from "@prisma/client";
import { ActionForm, Checkbox, Field, SelectField, SubmitButton, TextArea } from "@/components/forms";
import { UOM_LABEL } from "@/lib/units";
import { saveProductAction, saveRecipeAction } from "./actions";

const UOM_OPTS = Object.entries(UOM_LABEL).map(([value, label]) => ({ value, label }));

export function RecipeForm({ recipe, items }: { recipe?: Recipe & { ingredients: RecipeIngredient[] }; items: InventoryItem[] }) {
  const rows = [...(recipe?.ingredients ?? []), ...Array.from({ length: 3 }, () => null)];
  if (!recipe) rows.unshift(null);
  return (
    <ActionForm action={saveRecipeAction}>
      {recipe && <input type="hidden" name="id" value={recipe.id} />}
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Code" name="code" defaultValue={recipe?.code} required />
        <Field label="Recipe name" name="name" defaultValue={recipe?.name} required />
        <Field label="Flavor" name="flavor" defaultValue={recipe?.flavor} />
        <div />
        <Field label="Expected mix yield (grams)" name="yieldGrams" defaultValue={recipe?.yieldGrams.toString() ?? "3700"} required hint="e.g. 1 kg powder + 2.7 L water ≈ 3,700 g" />
        <Field label="Wastage assumption %" name="wastagePct" defaultValue={recipe?.wastagePct.toString() ?? "5"} hint="Machine residue, spillage, testing" />
      </div>
      <div className="card overflow-hidden">
        <table className="tbl">
          <thead><tr><th>Inventory item</th><th>…or free ingredient</th><th className="num">Quantity</th><th>Unit</th><th className="num">Cost / unit (free only)</th></tr></thead>
          <tbody>{rows.map((ing, idx) => (
            <tr key={idx}>
              <td><input type="hidden" name="row" value={idx} />
                <select className="input" name={`item_${idx}`} defaultValue={ing?.itemId ?? ""}><option value="">—</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name} ({UOM_LABEL[i.uom]})</option>)}</select></td>
              <td><input className="input" name={`name_${idx}`} defaultValue={ing && !ing.itemId ? ing.name : ""} placeholder="e.g. Water" /></td>
              <td className="num"><input className="input w-24 text-right" name={`qty_${idx}`} defaultValue={ing?.quantity.toString() ?? ""} /></td>
              <td><select className="input w-24" name={`uom_${idx}`} defaultValue={ing?.uom ?? "KG"}>{UOM_OPTS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select></td>
              <td className="num"><input className="input w-24 text-right" name={`cost_${idx}`} defaultValue={ing && !ing.itemId ? ing.unitCost.toString() : ""} placeholder="0" /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="text-xs text-choco-500">Inventory items are costed at their weighted-average cost; units convert automatically (g↔kg, mL↔L). Save to add more rows.</p>
      <TextArea label="Notes / preparation" name="notes" defaultValue={recipe?.notes} rows={2} />
      {recipe && <Checkbox label="Active" name="isActive" defaultChecked={recipe.isActive} />}
      <SubmitButton>{recipe ? "Save recipe" : "Create recipe"}</SubmitButton>
    </ActionForm>
  );
}

export function ProductForm({ product, items, recipes }: { product?: Product & { components: ProductComponent[] }; items: InventoryItem[]; recipes: Recipe[] }) {
  const rows = [...(product?.components ?? []), ...Array.from({ length: 3 }, () => null)];
  return (
    <ActionForm action={saveProductAction}>
      {product && <input type="hidden" name="id" value={product.id} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code" name="code" defaultValue={product?.code} required />
        <Field label="Product name" name="name" defaultValue={product?.name} required placeholder="e.g. Vanilla Cone 80g" />
        <SelectField label="Type" name="type" defaultValue={product?.type ?? "CONE"} options={[{ value: "CONE", label: "Cone" }, { value: "CUP", label: "Cup" }, { value: "OTHER", label: "Other" }]} />
        <SelectField label="Mix recipe" name="recipeId" defaultValue={product?.recipeId} placeholder="None" options={recipes.map((r) => ({ value: r.id, label: r.name }))} />
        <Field label="Serving size (grams of mix)" name="servingGrams" defaultValue={product?.servingGrams.toString() ?? "80"} hint="50 g, 80 g, 100 g…" />
        <Field label="Default selling price (₱)" name="defaultPrice" defaultValue={product?.defaultPrice.toString()} required hint="Override per partner on the partner's Prices tab" />
      </div>
      <div className="card overflow-hidden">
        <table className="tbl">
          <thead><tr><th>Packaging / topping component</th><th className="num">Qty per unit</th><th>Unit</th></tr></thead>
          <tbody>{rows.map((c, idx) => (
            <tr key={idx}>
              <td><input type="hidden" name="row" value={idx} /><select className="input" name={`item_${idx}`} defaultValue={c?.itemId ?? ""}><option value="">—</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name} ({UOM_LABEL[i.uom]})</option>)}</select></td>
              <td className="num"><input className="input w-24 text-right" name={`qty_${idx}`} defaultValue={c?.quantity.toString() ?? ""} /></td>
              <td><select className="input w-24" name={`uom_${idx}`} defaultValue={c?.uom ?? "PC"}>{UOM_OPTS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {product && <Checkbox label="Active (available on sales reports)" name="isActive" defaultChecked={product.isActive} />}
      <SubmitButton>{product ? "Save product" : "Create product"}</SubmitButton>
    </ActionForm>
  );
}
