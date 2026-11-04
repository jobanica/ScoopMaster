"use server";
import { requireUser } from "@/lib/auth";
import { safeAction } from "@/lib/action";
import { date, optStr, str } from "@/lib/form";
import { createSettlement, finalizeSettlement, recalculateSettlement, returnSettlementToDraft, submitSettlement, voidSettlement } from "@/server/services/settlements";

export const createSettlementAction = safeAction(async (fd) => {
  const user = await requireUser("settlements:prepare");
  const s = await createSettlement(user, { partnerId: str(fd, "partnerId", "Partner"), periodStart: date(fd, "periodStart", "Period start"), periodEnd: date(fd, "periodEnd", "Period end"), notes: optStr(fd, "notes") });
  return `/settlements/${s.id}`;
});
const step = (fn: (user: Awaited<ReturnType<typeof requireUser>>, id: string, fd: FormData) => Promise<unknown>, perm: Parameters<typeof requireUser>[0], message: string) =>
  safeAction(async (fd) => {
    const user = await requireUser(perm);
    const id = str(fd, "id");
    await fn(user, id, fd);
    return { revalidate: [`/settlements/${id}`], message };
  });
export const recalcAction = step((u, id) => recalculateSettlement(u, id), "settlements:prepare", "Recalculated from current approved data.");
export const submitAction = step((u, id) => submitSettlement(u, id), "settlements:prepare", "Submitted for approval. The period is now locked.");
export const returnAction = step((u, id, fd) => returnSettlementToDraft(u, id, str(fd, "reason", "Reason")), "settlements:approve", "Returned to draft.");
export const finalizeAction = step((u, id) => finalizeSettlement(u, id), "settlements:approve", "Settlement finalized.");
export const voidAction = step((u, id, fd) => voidSettlement(u, id, str(fd, "reason", "Reason")), "settlements:prepare", "Settlement voided.");
