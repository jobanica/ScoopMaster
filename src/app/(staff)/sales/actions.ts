"use server";
import { requireUser } from "@/lib/auth";
import { safeAction } from "@/lib/action";
import { optStr, str } from "@/lib/form";
import { approveCleanReports, approveSalesReport, rejectSalesReport, reopenSalesReport, reviewSalesEdit, saveSalesReport } from "@/server/services/sales";
import { intentSubmit, parseSalesForm } from "@/server/sales-form-data";

export const staffSaveSalesAction = safeAction(async (fd) => {
  const user = await requireUser("sales:write");
  const submit = intentSubmit(fd);
  const r = await saveSalesReport(user, { ...parseSalesForm(fd, str(fd, "partnerId", "Partner")), source: "MANUAL" }, { submit });
  return `/sales/${r.id}`;
});
export const approveSalesAction = safeAction(async (fd) => {
  const user = await requireUser("sales:review");
  const id = str(fd, "id");
  await approveSalesReport(user, id, optStr(fd, "reason"));
  return { revalidate: [`/sales/${id}`, "/sales"], message: "Report approved and consumption posted to inventory." };
});
export const rejectSalesAction = safeAction(async (fd) => {
  const user = await requireUser("sales:review");
  const id = str(fd, "id");
  await rejectSalesReport(user, id, str(fd, "reason", "Reason"));
  return { revalidate: [`/sales/${id}`], message: "Report returned to the partner." };
});
export const reopenSalesAction = safeAction(async (fd) => {
  const user = await requireUser("sales:review");
  const id = str(fd, "id");
  await reopenSalesReport(user, id, str(fd, "reason", "Reason"));
  return { revalidate: [`/sales/${id}`], message: "Report reopened for correction." };
});
export const reviewEditAction = safeAction(async (fd) => {
  const user = await requireUser("sales:review");
  await reviewSalesEdit(user, str(fd, "requestId"), str(fd, "decision") === "approve", optStr(fd, "reason"));
  return { revalidate: [`/sales/${str(fd, "id")}`], message: "Edit request reviewed." };
});
export const approveCleanAction = safeAction(async () => {
  const user = await requireUser("sales:review");
  const r = await approveCleanReports(user);
  return { revalidate: ["/sales"], message: `${r.approved} clean report(s) approved.${r.errors.length ? ` ${r.errors.length} could not be approved: ${r.errors[0]}` : ""}` };
});
