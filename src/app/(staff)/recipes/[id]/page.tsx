import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { D, formatQty, Decimal } from "@/lib/money";
import { addDays, manilaDayStart, todayDate } from "@/lib/dates";
import { UOM_LABEL } from "@/lib/units";
import { Card, DL, PageHeader, Peso } from "@/components/ui";
import { RecipeForm } from "../forms";
import { recipeWithCosting } from "../costing";

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("recipes:read");
  const data = await recipeWithCosting((await params).id);
  if (!data) notFound();
  const { recipe, owner, transfer, products } = data;
  const items = await prisma.inventoryItem.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });

  // Theoretical vs actual usage of this recipe's stocked ingredients at partner locations (last 30 days)
  const itemIds = recipe.ingredients.map((i) => i.itemId).filter(Boolean) as string[];
  const since = manilaDayStart(addDays(todayDate(), -30));
  const mv = await prisma.stockMovement.groupBy({ by: ["itemId", "type"], where: { itemId: { in: itemIds }, location: { type: "PARTNER" }, occurredAt: { gte: since }, type: { in: ["CONSUMPTION", "WASTAGE", "COUNT_VARIANCE", "DAMAGED", "EXPIRED"] } }, _sum: { quantity: true } });
  const usage = recipe.ingredients.filter((i) => i.item).map((i) => {
    const get = (t: string) => D(mv.find((m) => m.itemId === i.itemId && m.type === t)?._sum.quantity).negated();
    const theoretical = get("CONSUMPTION");
    const wastage = get("WASTAGE");
    const losses = get("COUNT_VARIANCE").plus(get("DAMAGED")).plus(get("EXPIRED"));
    const actual = theoretical.plus(wastage).plus(losses);
    const perGram = D(i.quantity).dividedBy(D(recipe.yieldGrams)); // ingredient qty (recipe uom) per gram of mix
    return { name: i.name, uom: UOM_LABEL[i.item!.uom], theoretical, wastage, losses, actual, efficiency: actual.gt(0) ? theoretical.dividedBy(actual).times(100) : new Decimal(100), perGram };
  });

  const sizes = [50, 80, 100];
  return (
    <div>
      <PageHeader title={recipe.name} subtitle={`${recipe.code}${recipe.flavor ? ` · ${recipe.flavor}` : ""}`} back={{ href: "/recipes", label: "Recipes" }} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Batch costing (owner cost)">
          <DL cols={1} items={[
            ["Ingredient cost per batch", <Peso key="b" v={owner.batchCost} />],
            ["Expected mix", `${formatQty(recipe.yieldGrams, 0)} g (${formatQty(D(recipe.yieldGrams).dividedBy(1000), 2)} kg)`],
            ["Cost per kilogram of mix", <Peso key="k" v={owner.costPerKg} />],
            ["Cost per gram", `₱${owner.costPerGram.toFixed(5)}`],
            ["Cost per gram incl. wastage", `₱${owner.effectiveCostPerGram.toFixed(5)} (${recipe.wastagePct.toString()}% wastage)`],
            ["Usable mix after wastage", `${formatQty(owner.usableGrams, 0)} g`],
          ]} />
          <ul className="mt-4 space-y-1 border-t border-choco-50 pt-3 text-sm">{owner.lines.map((l, i) => <li key={i} className="flex justify-between"><span>{l.name}</span><Peso v={l.cost} /></li>)}</ul>
        </Card>
        <Card title="Serving size scenarios (owner cost)" className="lg:col-span-2" pad={false}>
          <table className="tbl"><thead><tr><th>Serving</th><th className="num">Theoretical servings / batch</th><th className="num">Expected (after wastage)</th><th className="num">Mix cost / serving</th><th className="num">Cost / serving (transfer price)</th></tr></thead>
            <tbody>{sizes.map((g) => (
              <tr key={g}><td>{g} g</td><td className="num">{D(recipe.yieldGrams).dividedBy(g).floor().toString()}</td><td className="num">{owner.usableGrams.dividedBy(g).floor().toString()}</td><td className="num"><Peso v={owner.effectiveCostPerGram.times(g)} /></td><td className="num"><Peso v={transfer.effectiveCostPerGram.times(g)} /></td></tr>
            ))}</tbody></table>
          <p className="px-5 py-3 text-xs text-choco-500">Excludes cone/cup/spoon components — see product costing below.</p>
        </Card>
      </div>

      <Card title="Products made from this recipe" className="mt-4" pad={false}>
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Product</th><th className="num">Serving</th><th className="num">Default price</th><th className="num">Cost per unit (owner)</th><th className="num">Gross profit (owner)</th><th className="num">Cost per unit (partner)</th><th className="num">Partner GP</th><th className="num">Expected servings</th><th className="num">Expected revenue / batch</th><th className="num">Expected profit / batch</th></tr></thead>
          <tbody>{products.map(({ p, owner: o, transfer: t }) => (
            <tr key={p.id}><td><Link className="link" href={`/recipes/products/${p.id}`}>{p.name}</Link></td><td className="num">{formatQty(p.servingGrams, 0)} g</td><td className="num"><Peso v={p.defaultPrice} /></td><td className="num"><Peso v={o.unitCost} /></td><td className="num"><Peso v={o.grossProfit} /> <span className="text-xs text-choco-500">{o.marginPct.toFixed(0)}%</span></td><td className="num"><Peso v={t.unitCost} /></td><td className="num"><Peso v={t.grossProfit} /></td><td className="num">{o.expectedServings.toString()} <span className="text-xs text-choco-500">/ {o.theoreticalServings.toString()}</span></td><td className="num"><Peso v={o.expectedRevenuePerBatch} /></td><td className="num"><Peso v={o.expectedProfitPerBatch} /></td></tr>
          ))}</tbody>
        </table></div>
        {products.length === 0 && <p className="p-5 text-sm text-choco-500">No products use this recipe yet.</p>}
      </Card>

      <Card title="Theoretical vs actual usage at partner locations (last 30 days)" className="mt-4" pad={false}>
        <table className="tbl"><thead><tr><th>Ingredient</th><th className="num">Theoretical (units sold)</th><th className="num">Reported wastage</th><th className="num">Count variances & losses</th><th className="num">Actual usage</th><th className="num">Yield efficiency</th><th className="num">Servings lost to waste (80 g)</th></tr></thead>
          <tbody>{usage.map((u) => (
            <tr key={u.name}><td>{u.name}</td><td className="num">{formatQty(u.theoretical, 3)} {u.uom}</td><td className="num">{formatQty(u.wastage, 3)}</td><td className="num">{formatQty(u.losses, 3)}</td><td className="num font-semibold">{formatQty(u.actual, 3)}</td><td className={`num ${u.efficiency.lt(90) ? "text-berry-700" : "text-mint-700"}`}>{u.efficiency.toFixed(1)}%</td>
              <td className="num">{u.perGram.gt(0) ? u.wastage.plus(u.losses).dividedBy(u.perGram.times(80)).floor().toString() : "—"}</td></tr>
          ))}</tbody></table>
        <p className="px-5 py-3 text-xs text-choco-500">Theoretical usage is posted from approved sales reports. Wastage is reported daily; count variances come from physical counts. (Free ingredients like water are not tracked.)</p>
      </Card>

      {can(user.role, "recipes:write") && <Card title="Edit recipe" className="mt-4"><RecipeForm recipe={recipe} items={items} /></Card>}
    </div>
  );
}
