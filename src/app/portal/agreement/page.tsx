import { requirePartner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatPHP } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { Card, DL, Empty, PageHeader, humanize } from "@/components/ui";

export const metadata = { title: "Agreement" };
const MODEL: Record<string, string> = { PROFIT_SHARE: "Profit sharing", FIXED_FEE: "Fixed fee to Scoop Master", FEE_PLUS_SHARE: "Fixed fee plus profit sharing", REVENUE_SHARE: "Revenue sharing" };
export default async function PortalAgreement() {
  const user = await requirePartner();
  const [c, docs] = await Promise.all([
    prisma.partnerContract.findFirst({ where: { partnerId: user.partnerId, isActive: true } }),
    prisma.attachment.findMany({ where: { entityType: "Partner", entityId: user.partnerId, confidential: false, category: "CONTRACT" }, orderBy: { createdAt: "desc" } }),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Partnership agreement" />
      {!c ? <Empty>No active agreement on file.</Empty> : (
        <Card title={`Contract version ${c.version}`}>
          <DL items={[
            ["Effective", `${fmtDate(c.effectiveFrom)} – ${c.effectiveTo ? fmtDate(c.effectiveTo) : "until replaced"}`], ["Arrangement", MODEL[c.shareModel]],
            ["Scoop Master share", `${c.ownerSharePct.toString()}%`], ["Your share", `${c.partnerSharePct.toString()}%`], ["Fixed fee", formatPHP(c.fixedFee)],
            ["Supplies deducted at", c.cogsBasis === "TRANSFER_PRICE" ? "Your supply prices" : "Scoop Master's cost"], ["Operating expenses", c.deductOperatingExpenses ? "Approved expenses deducted before sharing" : "Not deducted"],
            ["Settlement schedule", humanize(c.settlementFrequency)], ["Settlement payment terms", `${c.paymentTermsDays} days`], ["Supply invoice terms", `${c.supplyPaymentTermsDays} days`],
          ]} />
          {c.terms && <p className="mt-4 whitespace-pre-wrap rounded-lg bg-cream-100 p-3 text-sm">{c.terms}</p>}
        </Card>
      )}
      <Card title="Signed documents">
        {docs.length === 0 ? <p className="text-sm text-choco-500">No documents uploaded.</p> : <ul className="space-y-1">{docs.map((d) => <li key={d.id}><a className="link text-sm" href={`/api/files/${d.id}`} target="_blank" rel="noreferrer">{d.fileName}</a></li>)}</ul>}
      </Card>
    </div>
  );
}
