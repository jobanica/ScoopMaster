import type { Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { fmtDate } from "@/lib/dates";

/**
 * A partner's period is "closed" once a settlement covering it is pending approval or finalized.
 * Sales, expenses and inventory movements dated inside a closed period are blocked, so a finalized
 * settlement can never silently change and nothing is counted in two settlements.
 */
export async function findClosingSettlement(tx: Tx, partnerId: string, date: Date) {
  return tx.settlement.findFirst({
    where: { partnerId, status: { in: ["PENDING_APPROVAL", "FINALIZED"] }, periodStart: { lte: date }, periodEnd: { gte: date } },
    select: { id: true, number: true, status: true, periodStart: true, periodEnd: true },
  });
}

export async function assertPeriodOpen(tx: Tx, partnerId: string, date: Date) {
  const s = await findClosingSettlement(tx, partnerId, date);
  if (s) {
    throw new AppError(
      `${fmtDate(date)} falls within settlement ${s.number} (${fmtDate(s.periodStart)}–${fmtDate(s.periodEnd)}, ${s.status.replace("_", " ").toLowerCase()}). ` +
        `Void or reject that settlement first to make changes.`,
    );
  }
}

export async function assertPeriodOpenForLocation(tx: Tx, locationId: string, date: Date) {
  const loc = await tx.location.findUnique({ where: { id: locationId }, select: { partnerId: true } });
  if (loc?.partnerId) await assertPeriodOpen(tx, loc.partnerId, date);
}
