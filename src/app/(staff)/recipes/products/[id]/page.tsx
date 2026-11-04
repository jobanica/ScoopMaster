import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { formatQty } from "@/lib/money";
import { costProduct, costRecipe } from "@/lib/calc/recipe";
import { UOM_LABEL } from "@/lib/units";
import { Card, DL, PageHeader, Peso } from "@/components/ui";
import { ProductForm } from "../../forms";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("recipes:read");
  const p = await prisma.product.findUnique({ where: { id: (await params).id }, include: { recipe: { include: { ingredients: { include: { item: true } } } }, components: { include: { item: true } }, partnerPrices: { where: { isActive: true }, include: { partner: true } } } });
  if (!p) notFound();
  const [items, recipes] = await Promise.all([prisma.inventoryItem.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }), prisma.recipe.findMany({ where: { isActive: true }, orderBy: { name: "asc" } })]);
  const rc = p.recipe ? costRecipe(p.recipe) : null;
  const c = costProduct({ servingGrams: p.servingGrams, price: p.defaultPrice, components: p.components }, rc);
  return (
    <div>
      <PageHeader title={p.name} subtitle={p.code} back={{ href: "/recipes/products", label: "Products" }} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Unit costing (owner cost)">
          <DL items={[
            ["Mix", p.recipe ? `${formatQty(p.servingGrams, 0)} g of ${p.recipe.name}` : "—"], ["Mix cost (incl. wastage)", <Peso key="m" v={c.mixCost} />],
            ["Components", p.components.map((x) => `${formatQty(x.quantity)} ${UOM_LABEL[x.uom]} ${x.item.name}`).join(", ") || "—"], ["Component cost", <Peso key="c" v={c.componentCost} />],
            ["Cost per unit", <Peso key="u" v={c.unitCost} className="font-bold" />], ["Default price", <Peso key="p" v={p.defaultPrice} />],
            ["Gross profit / unit", <span key="g"><Peso v={c.grossProfit} /> ({c.marginPct.toFixed(1)}%)</span>], ["Servings per batch", `${c.expectedServings} expected / ${c.theoreticalServings} theoretical`],
          ]} />
        </Card>
        <Card title="Partner-specific prices" pad={false}>
          {p.partnerPrices.length === 0 ? <p className="p-5 text-sm text-choco-500">All partners use the default price.</p> : (
            <table className="tbl"><tbody>{p.partnerPrices.map((pp) => <tr key={pp.id}><td>{pp.partner.businessName}</td><td className="num"><Peso v={pp.price} /></td></tr>)}</tbody></table>
          )}
        </Card>
      </div>
      {can(user.role, "recipes:write") && <Card title="Edit product" className="mt-4"><ProductForm product={p} items={items} recipes={recipes} /></Card>}
    </div>
  );
}
