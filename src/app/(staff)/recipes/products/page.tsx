import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { formatQty } from "@/lib/money";
import { costProduct, costRecipe } from "@/lib/calc/recipe";
import { Badge, Card, Empty, LinkButton, PageHeader, Peso, humanize } from "@/components/ui";
import { RecipeTabs } from "../tabs";

export const metadata = { title: "Products" };
export default async function ProductsPage() {
  const user = await requirePage("recipes:read");
  const products = await prisma.product.findMany({ include: { recipe: { include: { ingredients: { include: { item: true } } } }, components: { include: { item: true } }, _count: { select: { partnerPrices: { where: { isActive: true } } } } }, orderBy: [{ type: "asc" }, { name: "asc" }] });
  return (
    <div>
      <PageHeader title="Recipes & product costing" actions={can(user.role, "recipes:write") && <LinkButton href="/recipes/products/new">+ New product</LinkButton>} />
      <RecipeTabs active="products" />
      <Card pad={false}>
        {products.length === 0 ? <div className="p-5"><Empty>No products yet.</Empty></div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Code</th><th>Product</th><th>Type</th><th>Recipe</th><th className="num">Serving</th><th className="num">Default price</th><th className="num">Cost / unit</th><th className="num">Gross profit</th><th className="num">Custom prices</th></tr></thead>
            <tbody>{products.map((p) => {
              const rc = p.recipe ? costRecipe(p.recipe) : null;
              const c = costProduct({ servingGrams: p.servingGrams, price: p.defaultPrice, components: p.components }, rc);
              return (
                <tr key={p.id}><td className="font-mono text-xs">{p.code}</td><td><Link className="link" href={`/recipes/products/${p.id}`}>{p.name}</Link> {!p.isActive && <Badge>inactive</Badge>}</td><td>{humanize(p.type)}</td><td>{p.recipe?.name ?? "—"}</td><td className="num">{formatQty(p.servingGrams, 0)} g</td><td className="num"><Peso v={p.defaultPrice} /></td><td className="num"><Peso v={c.unitCost} /></td><td className="num"><Peso v={c.grossProfit} /> <span className="text-xs text-choco-500">{c.marginPct.toFixed(0)}%</span></td><td className="num">{p._count.partnerPrices}</td></tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
