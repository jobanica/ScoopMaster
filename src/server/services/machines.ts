import type { MachineCondition, MachineStatus, MaintenanceStatus, MaintenanceType } from "@prisma/client";
import { prisma, withTx } from "@/lib/db";
import { nextCode } from "@/lib/sequence";
import { audit } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import { D, money, Decimal } from "@/lib/money";
import { addDays, daysBetween, todayDate } from "@/lib/dates";
import type { Actor } from "../actor";
import { notify } from "./notifications";
import { createBill } from "./finance";

export type MachineInput = {
  brand: string; model: string; machineType?: string | null; nozzles: number; serialNumber: string;
  purchaseDate?: Date | null; purchasePrice: string; warrantyExpiry?: Date | null; condition: MachineCondition;
  nextMaintenanceDate?: Date | null; notes?: string | null;
};

export async function createMachine(actor: Actor, input: MachineInput) {
  if (D(input.purchasePrice).isNegative()) throw new AppError("Purchase price cannot be negative.");
  if (input.nozzles < 1 || input.nozzles > 10) throw new AppError("Nozzles must be between 1 and 10.");
  return withTx(async (tx) => {
    if (await tx.machine.findUnique({ where: { serialNumber: input.serialNumber } })) throw new AppError("A machine with this serial number already exists.");
    const m = await tx.machine.create({ data: { ...input, purchasePrice: money(input.purchasePrice).toString(), code: await nextCode(tx, "MCH", 4) } });
    await audit(tx, { userId: actor.id, action: "CREATE", entityType: "Machine", entityId: m.id, after: m });
    return m;
  });
}

export async function updateMachine(actor: Actor, id: string, input: MachineInput) {
  return withTx(async (tx) => {
    const before = await tx.machine.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Machine");
    const dup = await tx.machine.findFirst({ where: { serialNumber: input.serialNumber, NOT: { id } } });
    if (dup) throw new AppError("Another machine already uses this serial number.");
    const after = await tx.machine.update({ where: { id }, data: { ...input, purchasePrice: money(input.purchasePrice).toString() } });
    await audit(tx, { userId: actor.id, action: "UPDATE", entityType: "Machine", entityId: id, before, after });
    return after;
  });
}

/** Deploys an unassigned machine, or transfers a deployed machine to another partner (full audit trail). */
export async function assignMachine(actor: Actor, machineId: string, partnerId: string, date: Date, reason: string) {
  return withTx(async (tx) => {
    const m = await tx.machine.findUnique({ where: { id: machineId } });
    if (!m) throw new NotFoundError("Machine");
    if (["SOLD", "UNDER_MAINTENANCE"].includes(m.status)) throw new AppError(`A machine that is ${m.status.toLowerCase().replace("_", " ")} cannot be deployed.`);
    if (m.currentPartnerId === partnerId) throw new AppError("Machine is already assigned to this partner.");
    const partner = await tx.partner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new NotFoundError("Partner");
    if (!["ACTIVE", "PENDING_APPROVAL"].includes(partner.status)) throw new AppError("Machines can only be assigned to active or pending partners.");
    const open = await tx.machineAssignment.findFirst({ where: { machineId, endDate: null } });
    if (open) {
      if (date < open.startDate) throw new AppError("Transfer date cannot be before the current deployment date.");
      await tx.machineAssignment.update({ where: { id: open.id }, data: { endDate: date } });
    }
    await tx.machineAssignment.create({ data: { machineId, partnerId, startDate: date, reason, createdById: actor.id } });
    const after = await tx.machine.update({ where: { id: machineId }, data: { status: "DEPLOYED", currentPartnerId: partnerId, deployedAt: date } });
    await audit(tx, { userId: actor.id, action: open ? "MACHINE_TRANSFER" : "MACHINE_DEPLOY", entityType: "Machine", entityId: machineId, summary: reason, before: { partnerId: m.currentPartnerId, status: m.status }, after: { partnerId, status: "DEPLOYED" } });
    return after;
  });
}

export async function returnMachine(actor: Actor, machineId: string, date: Date, reason: string, condition: MachineCondition) {
  return withTx(async (tx) => {
    const m = await tx.machine.findUnique({ where: { id: machineId } });
    if (!m) throw new NotFoundError("Machine");
    if (!m.currentPartnerId) throw new AppError("Machine is not assigned to a partner.");
    const open = await tx.machineAssignment.findFirst({ where: { machineId, endDate: null } });
    if (open) await tx.machineAssignment.update({ where: { id: open.id }, data: { endDate: date, reason: open.reason ? `${open.reason} | Returned: ${reason}` : `Returned: ${reason}` } });
    const after = await tx.machine.update({ where: { id: machineId }, data: { status: "RETURNED", currentPartnerId: null, deployedAt: null, condition } });
    await audit(tx, { userId: actor.id, action: "MACHINE_RETURN", entityType: "Machine", entityId: machineId, summary: reason, before: m, after });
    return after;
  });
}

const MANUAL_STATUSES: MachineStatus[] = ["AVAILABLE", "RESERVED", "UNDER_MAINTENANCE", "RETURNED", "SOLD"];

export async function setMachineStatus(actor: Actor, machineId: string, status: MachineStatus, reason: string) {
  if (!MANUAL_STATUSES.includes(status)) throw new AppError("Use Deploy / Transfer to deploy a machine.");
  return withTx(async (tx) => {
    const m = await tx.machine.findUniqueOrThrow({ where: { id: machineId } });
    if (m.status === "SOLD") throw new AppError("Sold machines cannot change status.");
    if (m.currentPartnerId && status !== "UNDER_MAINTENANCE") throw new AppError("Return the machine from its partner first.");
    const after = await tx.machine.update({ where: { id: machineId }, data: { status } });
    await audit(tx, { userId: actor.id, action: "MACHINE_STATUS", entityType: "Machine", entityId: machineId, summary: `${m.status} → ${status}: ${reason}` });
    return after;
  });
}

export async function reportMachineProblem(actor: Actor, input: { machineId: string; description: string; type?: MaintenanceType }) {
  return withTx(async (tx) => {
    const m = await tx.machine.findUnique({ where: { id: input.machineId } });
    if (!m) throw new NotFoundError("Machine");
    if (actor.role === "PARTNER" && m.currentPartnerId !== actor.partnerId) throw new AppError("This machine is not assigned to you.", 403);
    const rec = await tx.maintenanceRecord.create({
      data: { number: await nextCode(tx, "MNT", 5), machineId: m.id, partnerId: m.currentPartnerId, type: input.type ?? "PROBLEM_REPORT", description: input.description, reportedById: actor.id },
    });
    await audit(tx, { userId: actor.id, action: "MAINTENANCE_CREATE", entityType: "MaintenanceRecord", entityId: rec.id, after: rec });
    await notify("MACHINE_PROBLEM", { title: `${m.code}: ${input.type === "PREVENTIVE" ? "maintenance scheduled" : "problem reported"}`, body: input.description.slice(0, 200), link: `/machines/${m.id}`, severity: "WARNING", dedupeKey: `mnt-${rec.id}` }, tx);
    return rec;
  });
}

export async function updateMaintenance(
  actor: Actor,
  id: string,
  input: { status: MaintenanceStatus; resolution?: string | null; cost: string; technicianId?: string | null; createBill: boolean; billDueDate?: Date | null; putMachineUnderMaintenance?: boolean; nextMaintenanceDate?: Date | null },
) {
  return withTx(async (tx) => {
    const rec = await tx.maintenanceRecord.findUnique({ where: { id }, include: { machine: true } });
    if (!rec) throw new NotFoundError("Maintenance record");
    if (rec.status === "RESOLVED" || rec.status === "CANCELLED") throw new AppError("This record is closed.");
    const cost = money(input.cost);
    if (cost.isNegative()) throw new AppError("Cost cannot be negative.");
    let billId = rec.billId;
    if (input.createBill && cost.gt(0) && !billId) {
      const tech = input.technicianId ? await tx.contact.findUnique({ where: { id: input.technicianId } }) : null;
      const bill = await createBill(actor, {
        category: rec.type === "PREVENTIVE" || rec.type === "INSPECTION" ? "MAINTENANCE" : "MACHINE_REPAIR",
        contactId: tech?.id ?? null, payeeName: tech?.name ?? "Service technician",
        description: `${rec.number} – ${rec.machine.code}: ${rec.description.slice(0, 120)}`,
        billDate: todayDate(), dueDate: input.billDueDate ?? todayDate(), amount: cost.toString(),
      }, tx);
      billId = bill.id;
    }
    const after = await tx.maintenanceRecord.update({
      where: { id },
      data: {
        status: input.status, resolution: input.resolution, cost: cost.toString(), technicianId: input.technicianId ?? null, billId,
        resolvedAt: input.status === "RESOLVED" ? new Date() : null,
      },
    });
    if (input.putMachineUnderMaintenance && rec.machine.status !== "UNDER_MAINTENANCE" && input.status !== "RESOLVED") {
      await tx.machine.update({ where: { id: rec.machineId }, data: { status: "UNDER_MAINTENANCE" } });
    }
    if (input.status === "RESOLVED") {
      await tx.machine.update({
        where: { id: rec.machineId },
        data: {
          ...(rec.machine.status === "UNDER_MAINTENANCE" ? { status: rec.machine.currentPartnerId ? "DEPLOYED" : "AVAILABLE" } : {}),
          ...(input.nextMaintenanceDate ? { nextMaintenanceDate: input.nextMaintenanceDate } : {}),
        },
      });
    }
    await audit(tx, { userId: actor.id, action: "MAINTENANCE_UPDATE", entityType: "MaintenanceRecord", entityId: id, before: rec, after });
    return after;
  });
}

/**
 * Machine profitability. Partnership income is earned per partner settlement, so it is attributed to each
 * machine in proportion to that machine's share of the partner's net sales within each finalized settlement.
 */
export async function machineProfitability(machineId?: string) {
  const machines = await prisma.machine.findMany({
    where: machineId ? { id: machineId } : {},
    include: { assignments: true, maintenance: { where: { status: { not: "CANCELLED" } } } },
    orderBy: { code: "asc" },
  });
  const settlements = await prisma.settlement.findMany({
    where: { status: "FINALIZED" },
    include: { salesReports: { select: { machineId: true, netSales: true } } },
  });
  const sales = await prisma.salesReport.groupBy({ by: ["machineId"], where: { status: "APPROVED", machineId: { in: machines.map((m) => m.id) } }, _sum: { netSales: true, estimatedCogs: true, totalUnits: true } });
  const salesBy = new Map(sales.map((s) => [s.machineId, s._sum]));
  const today = todayDate();

  return machines.map((m) => {
    let attributedIncome = new Decimal(0);
    for (const s of settlements) {
      const total = s.salesReports.reduce((a, r) => a.plus(D(r.netSales)), new Decimal(0));
      if (total.isZero()) continue;
      const mine = s.salesReports.filter((r) => r.machineId === m.id).reduce((a, r) => a.plus(D(r.netSales)), new Decimal(0));
      if (mine.isZero()) continue;
      attributedIncome = attributedIncome.plus(D(s.ownerShare).times(mine).dividedBy(total));
    }
    const maintenance = m.maintenance.reduce((a, r) => a.plus(D(r.cost)), new Decimal(0));
    const s = salesBy.get(m.id);
    const totalSales = D(s?.netSales);
    const supplies = D(s?.estimatedCogs);
    const netProfit = money(attributedIncome.minus(maintenance));
    const price = D(m.purchasePrice);
    const start = m.purchaseDate ?? m.createdAt;
    const lifeDays = Math.max(1, daysBetween(new Date(start.toISOString().slice(0, 10)), today));
    const deployedDays = m.assignments.reduce((a, as) => a + Math.max(0, daysBetween(as.startDate, as.endDate ?? today)), 0);
    return {
      machine: m,
      totalSales: money(totalSales),
      totalUnits: s?.totalUnits ?? 0,
      suppliesConsumed: money(supplies),
      partnershipIncome: money(attributedIncome),
      maintenanceCost: money(maintenance),
      netProfit,
      roiPct: price.gt(0) ? netProfit.dividedBy(price).times(100) : new Decimal(0),
      paybackRemaining: Decimal.max(0, price.minus(netProfit)),
      utilizationPct: Math.min(100, Math.round((deployedDays / lifeDays) * 1000) / 10),
      deployedDays,
    };
  });
}

export async function machinesDueForMaintenance(withinDays: number) {
  return prisma.machine.findMany({ where: { nextMaintenanceDate: { lte: addDays(todayDate(), withinDays) }, status: { notIn: ["SOLD"] } } });
}
