import Link from "next/link";
import { requirePartner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { D, formatQty } from "@/lib/money";
import { fmtDateTime } from "@/lib/dates";
import { UOM_LABEL } from "@/lib/units";
import { Badge, Card, Empty, LinkButton, PageHeader, humanize } from "@/components/ui";

export const metadata = { title: "My stock" };
export default async function PortalInventory() {
  const user = await requirePartner();
  const loc = await prisma.location.findUnique({ where: { partnerId: user.partnerId } });
  const [levels, moves] = loc ? await Promise.all([
    prisma.stockLevel.findMany({ where: { locationId: loc.id }, include: { item: true }, orderBy: { item: { name: "asc" } } }),
    prisma.stockMovement.findMany({ where: { locationId: loc.id }, include: { item: true }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]) : [[], []];
  return (
    <div className="space-y-4">
      <PageHeader title="My stock" subtitle="Expected stock from deliveries minus usage from your approved sales reports." actions={<LinkButton href="/portal/supply-requests/new">Request supplies</LinkButton>} />
      <Card pad={false}>
        {levels.length === 0 ? <div className="p-5"><Empty>No stock recorded yet.</Empty></div> : (
          <table className="tbl"><tbody>{levels.map((l) => (
            <tr key={l.id}><td>{l.item.name}</td><td className="num font-semibold">{formatQty(l.quantity, 2)} {UOM_LABEL[l.item.uom]}</td><td>{D(l.item.partnerMinStock).gt(0) && D(l.quantity).lte(D(l.item.partnerMinStock)) && <Badge tone="berry">low</Badge>}</td></tr>
          ))}</tbody></table>
        )}
      </Card>
      <Card title="Recent stock activity" pad={false}>
        {moves.length === 0 ? <div className="p-5"><Empty /></div> : <table className="tbl"><tbody>{moves.map((m) => <tr key={m.id}><td className="text-xs">{fmtDateTime(m.occurredAt)}</td><td>{m.item.name}<div className="text-xs text-choco-500">{humanize(m.type)}</div></td><td className={`num ${D(m.quantity).isNegative() ? "text-berry-700" : "text-mint-700"}`}>{formatQty(m.quantity, 3)}</td></tr>)}</tbody></table>}
      </Card>
      <p className="text-xs text-choco-500">Notice a difference from your actual count? Tell us in your daily report notes or <Link className="link" href="/portal/notifications">contact Scoop Master</Link>.</p>
    </div>
  );
}
