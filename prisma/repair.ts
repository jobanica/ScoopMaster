import { prisma, withTx } from "../src/lib/db";
import { audit } from "../src/lib/audit";
import { undoCountPostings } from "../src/server/services/sales";

/**
 * Idempotent data repair (runs on every deploy via the seed step):
 * closing counts that are REJECTED or DRAFT must not keep stock postings. Before the fix, rejecting a count left its
 * CONSUMPTION/WASTAGE movements in the ledger, so the partner's "should have" was too low when they recounted.
 */
export async function repairRejectedCountPostings() {
  const reports = await prisma.salesReport.findMany({
    where: { method: "INVENTORY_COUNT", status: { in: ["REJECTED", "DRAFT"] } },
    orderBy: { reportDate: "desc" },
  });
  let fixed = 0;
  for (const r of reports) {
    const open = await prisma.stockMovement.count({ where: { sourceType: "SalesReport", sourceId: r.id, reversedBy: null, type: { in: ["CONSUMPTION", "WASTAGE"] } } });
    if (!open) continue;
    try {
      await withTx(async (tx) => {
        const n = await undoCountPostings(tx, null, r, `Data repair: ${r.status.toLowerCase()} count must not keep stock postings`);
        await audit(tx, { action: "DATA_REPAIR", entityType: "SalesReport", entityId: r.id, summary: `Reversed ${n} stock posting(s) left by ${r.status.toLowerCase()} report ${r.number}; shift reopened` });
      });
      fixed++;
      console.log(`  ✔ repaired ${r.number}`);
    } catch (e) {
      console.warn(`  ⚠ could not repair ${r.number}: ${(e as Error).message}`);
    }
  }
  return fixed;
}
