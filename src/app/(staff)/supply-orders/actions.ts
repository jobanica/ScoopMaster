"use server";
import { requireUser } from "@/lib/auth";
import { safeAction } from "@/lib/action";
import { optStr, str } from "@/lib/form";
import { parseSupplyLines, qtyMap } from "@/server/supply-form";
import { cancelSupplyOrder, confirmSupplyReceipt, createSupplyRequest, dispatchSupplyOrder, markPreparing, reviewSupplyOrder } from "@/server/services/supply";

export const createSupplyOrderAction = safeAction(async (fd) => {
  const user = await requireUser("supply:review");
  const o = await createSupplyRequest(user, { partnerId: str(fd, "partnerId", "Partner"), notes: optStr(fd, "notes"), lines: parseSupplyLines(fd) });
  return `/supply-orders/${o.id}`;
});
export const reviewSupplyAction = safeAction(async (fd) => {
  const user = await requireUser("supply:review");
  const id = str(fd, "id");
  await reviewSupplyOrder(user, id, { approve: str(fd, "decision") === "approve", notes: optStr(fd, "reason") ?? optStr(fd, "notes"), approvedQty: qtyMap(fd, "approved_") });
  return { revalidate: [`/supply-orders/${id}`], message: "Order reviewed." };
});
export const preparingAction = safeAction(async (fd) => {
  const user = await requireUser("supply:fulfil");
  const id = str(fd, "id");
  await markPreparing(user, id);
  return { revalidate: [`/supply-orders/${id}`], message: "Marked as preparing." };
});
export const dispatchAction = safeAction(async (fd) => {
  const user = await requireUser("supply:fulfil");
  const id = str(fd, "id");
  await dispatchSupplyOrder(user, id);
  return { revalidate: [`/supply-orders/${id}`], message: "Dispatched. Warehouse stock reduced; goods are in transit." };
});
export const receiveAction = safeAction(async (fd) => {
  const user = await requireUser("supply:fulfil");
  const id = str(fd, "id");
  await confirmSupplyReceipt(user, id, { receivedQty: qtyMap(fd, "received_"), notes: optStr(fd, "notes") });
  return { revalidate: [`/supply-orders/${id}`], message: "Receipt confirmed and supply invoice generated." };
});
export const cancelSupplyAction = safeAction(async (fd) => {
  const user = await requireUser("supply:review");
  const id = str(fd, "id");
  await cancelSupplyOrder(user, id, str(fd, "reason", "Reason"));
  return { revalidate: [`/supply-orders/${id}`], message: "Order cancelled." };
});
