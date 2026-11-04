"use server";
import { requireUser } from "@/lib/auth";
import { safeAction } from "@/lib/action";
import { date, optStr, str } from "@/lib/form";
import { createDueSettlements, finalizePendingSettlements, createSettlement, finalizeSettlement, recalculateSettlement, returnSettlementToDraft, submitSettlement, voidSettlement } from "@/server/services/settlements";

export const createSettlementAction = safeAction(async (fd) => {
  const user = await requireUser("settlements:prepare");
  const s = await createSettlement(user, { partnerId: str(fd, "partnerId", "Partner"), periodStart: date(fd, "periodStart", "Period start"), periodEnd: date(fd, "periodEnd", "Period end"), notes: optStr(fd, "notes") });
  return `/settlements/${s.id}`;
});
export const recalcAction = safeAction(async (fd) => {
  const user = await requireUser("settlements:prepare");
  const id = str(fd, "id");
  await recalculateSettlement(user, id);
  return { revalidate: [`/settlements/${id}`], message: "Recalculated from current approved data." };
});
export const submitAction = safeAction(async (fd) => {
  const user = await requireUser("settlements:prepare");
  const id = str(fd, "id");
  await submitSettlement(user, id);
  return { revalidate: [`/settlements/${id}`], message: "Submitted for approval. The period is now locked." };
});
export const returnAction = safeAction(async (fd) => {
  const user = await requireUser("settlements:approve");
  const id = str(fd, "id");
  await returnSettlementToDraft(user, id, str(fd, "reason", "Reason"));
  return { revalidate: [`/settlements/${id}`], message: "Returned to draft." };
});
export const finalizeAction = safeAction(async (fd) => {
  const user = await requireUser("settlements:approve");
  const id = str(fd, "id");
  await finalizeSettlement(user, id);
  return { revalidate: [`/settlements/${id}`], message: "Settlement finalized." };
});
export const voidAction = safeAction(async (fd) => {
  const user = await requireUser("settlements:prepare");
  const id = str(fd, "id");
  await voidSettlement(user, id, str(fd, "reason", "Reason"));
  return { revalidate: [`/settlements/${id}`], message: "Settlement voided." };
});
export const createDueAction = safeAction(async () => {
  const user = await requireUser("settlements:prepare");
  const r = await createDueSettlements(user, { submit: true });
  return { revalidate: ["/settlements"], message: `${r.created} settlement(s) created, ${r.submitted} submitted for approval.${r.skipped.length ? ` ${r.skipped.length} need attention: ${r.skipped.slice(0, 3).join(" | ")}` : ""}` };
});
export const finalizePendingAction = safeAction(async () => {
  const user = await requireUser("settlements:approve");
  const r = await finalizePendingSettlements(user);
  return { revalidate: ["/settlements"], message: `${r.finalized} settlement(s) finalized.${r.failed.length ? ` ${r.failed.length} failed: ${r.failed.slice(0, 3).join(" | ")}` : ""}` };
});
