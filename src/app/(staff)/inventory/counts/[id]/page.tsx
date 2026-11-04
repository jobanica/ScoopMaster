import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { D, formatQty } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { UOM_LABEL } from "@/lib/units";
import { Card, PageHeader, Peso, StatusBadge } from "@/components/ui";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/forms";
import { cancelCountAction, saveCountAction } from "../../actions";

export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("inventory:read");
  const c = await prisma.stockCount.findUnique({ where: { id: (await params).id }, include: { location: true, lines: { include: { item: true }, orderBy: { item: { name: "asc" } } } } });
  if (!c) notFound();
  const editable = c.status === "DRAFT" && can(user.role, "inventory:write");
  const valueBasis = c.location.type === "PARTNER" ? "partnerPrice" : "avgCost";
  return (
    <div>
      <PageHeader title={`Physical count ${c.number}`} back={{ href: "/inventory/counts", label: "Counts" }} subtitle={<span>{c.location.name} · {fmtDate(c.countDate)} · <StatusBadge status={c.status} /> {c.postedAt && `posted ${fmtDateTime(c.postedAt)}`}</span>}
        actions={editable && <ConfirmAction action={cancelCountAction} label="Cancel count" title="Cancel this count?" hidden={{ id: c.id }} variant="secondary" />} />
      <Card pad={false}>
        <ActionForm action={saveCountAction} className="space-y-0">
          <input type="hidden" name="countId" value={c.id} />
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Item</th><th className="num">System qty (snapshot)</th><th className="num">Counted</th><th className="num">Variance</th><th className="num">Variance value</th><th>Reason</th></tr></thead>
            <tbody>{c.lines.map((l) => {
              const variance = l.countedQty !== null ? D(l.countedQty).minus(D(l.systemQty)) : null;
              return (
                <tr key={l.id}>
                  <td>{l.item.name} <span className="text-xs text-choco-500">{UOM_LABEL[l.item.uom]}</span><input type="hidden" name="lineId" value={l.id} /></td>
                  <td className="num">{formatQty(l.systemQty, 3)}</td>
                  <td className="num">{editable ? <input className="input w-28 text-right" name={`counted_${l.id}`} defaultValue={l.countedQty?.toString() ?? ""} inputMode="decimal" /> : l.countedQty !== null ? formatQty(l.countedQty, 3) : "—"}</td>
                  <td className={`num ${variance?.isNegative() ? "text-berry-700" : ""}`}>{variance ? formatQty(variance, 3) : "—"}</td>
                  <td className="num">{variance ? <Peso v={variance.times(D(l.item[valueBasis]))} /> : "—"}</td>
                  <td>{editable ? <input className="input" name={`reason_${l.id}`} defaultValue={l.reason ?? ""} placeholder="e.g. spillage" /> : l.reason}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
          {editable && (
            <div className="flex gap-2 p-4">
              <SubmitButton name="intent" value="save" className="btn-secondary">Save progress</SubmitButton>
              <SubmitButton name="intent" value="post" pendingText="Posting…">Save & post count</SubmitButton>
              <span className="self-center text-xs text-choco-500">Leave blank for items not counted. Posting is final.</span>
            </div>
          )}
        </ActionForm>
      </Card>
    </div>
  );
}
