import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { costRecipe } from "@/lib/calc/recipe";
import { formatQty } from "@/lib/money";
import { RecipeTabs } from "./tabs";
import { Badge, Card, Empty, LinkButton, PageHeader, Peso } from "@/components/ui";

export const metadata = { title: "Recipes" };

export default async function RecipesPage() {
  const user = await requirePage("recipes:read");
  const recipes = await prisma.recipe.findMany({ include: { ingredients: { include: { item: true } }, _count: { select: { products: true } } }, orderBy: { name: "asc" } });
  return (
    <div>
      <PageHeader title="Recipes & product costing" actions={can(user.role, "recipes:write") && <LinkButton href="/recipes/new">+ New recipe</LinkButton>} />
      <RecipeTabs active="recipes" />
      <Card pad={false}>
        {recipes.length === 0 ? <div className="p-5"><Empty>No recipes yet. Example: 1 kg powder + 2.7 L water ≈ 3.7 kg mix.</Empty></div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Code</th><th>Recipe</th><th>Ingredients</th><th className="num">Yield</th><th className="num">Batch cost</th><th className="num">Cost / kg</th><th className="num">Cost / g (incl. wastage)</th><th className="num">Products</th></tr></thead>
            <tbody>{recipes.map((r) => {
              let c: ReturnType<typeof costRecipe> | null = null; try { c = costRecipe(r); } catch { c = null; }
              return (
                <tr key={r.id}>
                  <td className="font-mono text-xs">{r.code}</td>
                  <td><Link className="link" href={`/recipes/${r.id}`}>{r.name}</Link> {!r.isActive && <Badge>inactive</Badge>}</td>
                  <td className="text-xs">{r.ingredients.map((i) => `${formatQty(i.quantity)} ${i.uom.toLowerCase()} ${i.name}`).join(" + ")}</td>
                  <td className="num">{formatQty(r.yieldGrams, 0)} g</td>
                  <td className="num">{c ? <Peso v={c.batchCost} /> : "—"}</td>
                  <td className="num">{c ? <Peso v={c.costPerKg} /> : "—"}</td>
                  <td className="num">{c ? `₱${c.effectiveCostPerGram.toFixed(4)}` : "—"}</td>
                  <td className="num">{r._count.products}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
