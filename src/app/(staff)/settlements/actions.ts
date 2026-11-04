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
