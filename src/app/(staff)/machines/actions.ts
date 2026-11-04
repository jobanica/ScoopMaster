"use server";
import { requireUser } from "@/lib/auth";
import { safeAction } from "@/lib/action";
import { amount, bool, date, int, oneOf, optDate, optStr, str } from "@/lib/form";
import { assignMachine, createMachine, updateMachine, returnMachine, setMachineStatus, reportMachineProblem, updateMaintenance } from "@/server/services/machines";

const CONDITIONS = ["NEW", "GOOD", "FAIR", "POOR", "DEFECTIVE"] as const;

function machineInput(fd: FormData) {
  return {
    brand: str(fd, "brand", "Brand"), model: str(fd, "model", "Model"), machineType: optStr(fd, "machineType"),
    nozzles: int(fd, "nozzles", "Nozzles", { min: 1, max: 10 }), serialNumber: str(fd, "serialNumber", "Serial number"),
    purchaseDate: optDate(fd, "purchaseDate", "Purchase date"), purchasePrice: amount(fd, "purchasePrice", "Purchase price", { optional: true }),
    warrantyExpiry: optDate(fd, "warrantyExpiry", "Warranty expiry"), condition: oneOf(fd, "condition", CONDITIONS, "Condition"),
    nextMaintenanceDate: optDate(fd, "nextMaintenanceDate", "Next maintenance"), notes: optStr(fd, "notes"),
  };
}

export const createMachineAction = safeAction(async (fd) => {
  const user = await requireUser("machines:write");
  const m = await createMachine(user, machineInput(fd));
  return `/machines/${m.id}`;
});
export const updateMachineAction = safeAction(async (fd) => {
  const user = await requireUser("machines:write");
  const id = str(fd, "id");
  await updateMachine(user, id, machineInput(fd));
  return `/machines/${id}`;
});
export const assignMachineAction = safeAction(async (fd) => {
  const user = await requireUser("machines:write");
  const id = str(fd, "machineId");
  await assignMachine(user, id, str(fd, "partnerId", "Partner"), date(fd, "date", "Date"), str(fd, "reason", "Reason"));
  return { revalidate: [`/machines/${id}`], message: "Machine assignment updated." };
});
export const returnMachineAction = safeAction(async (fd) => {
  const user = await requireUser("machines:write");
  const id = str(fd, "machineId");
  await returnMachine(user, id, date(fd, "date", "Date"), str(fd, "reason", "Reason"), oneOf(fd, "condition", CONDITIONS));
  return { revalidate: [`/machines/${id}`], message: "Machine returned." };
});
export const machineStatusAction = safeAction(async (fd) => {
  const user = await requireUser("machines:write");
  const id = str(fd, "machineId");
  await setMachineStatus(user, id, oneOf(fd, "status", ["AVAILABLE", "RESERVED", "UNDER_MAINTENANCE", "RETURNED", "SOLD"] as const), str(fd, "reason", "Reason"));
  return { revalidate: [`/machines/${id}`], message: "Status updated." };
});
export const createMaintenanceAction = safeAction(async (fd) => {
  const user = await requireUser("maintenance:write");
  const id = str(fd, "machineId");
  await reportMachineProblem(user, { machineId: id, description: str(fd, "description", "Description"), type: oneOf(fd, "type", ["PREVENTIVE", "REPAIR", "INSPECTION", "PROBLEM_REPORT"] as const) });
  return { revalidate: [`/machines/${id}`], message: "Maintenance record created." };
});
export const updateMaintenanceAction = safeAction(async (fd) => {
  const user = await requireUser("maintenance:write");
  const id = str(fd, "id");
  await updateMaintenance(user, id, {
    status: oneOf(fd, "status", ["OPEN", "IN_PROGRESS", "RESOLVED", "CANCELLED"] as const), resolution: optStr(fd, "resolution"),
    cost: amount(fd, "cost", "Cost", { optional: true }), technicianId: optStr(fd, "technicianId"), createBill: bool(fd, "createBill"),
    billDueDate: optDate(fd, "billDueDate"), putMachineUnderMaintenance: bool(fd, "underMaintenance"), nextMaintenanceDate: optDate(fd, "nextMaintenanceDate"),
  });
  return { revalidate: [`/machines/${str(fd, "machineId")}`], message: "Maintenance record updated." };
});
