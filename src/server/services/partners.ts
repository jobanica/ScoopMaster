import type { PartnerStatus, Prisma } from "@prisma/client";
import { prisma, withTx, type Tx } from "@/lib/db";
import { nextCode } from "@/lib/sequence";
import { audit } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import { D, money } from "@/lib/money";
import { addDays } from "@/lib/dates";
import { hashPassword, passwordProblem } from "@/lib/password";
import type { Actor } from "../actor";
import { ensurePartnerLocation } from "./inventory";

export type PartnerInput = {
  businessName: string;
  ownerName: string;
  contactNumber?: string | null;
  email?: string | null;
  address?: string | null;
  area?: string | null;
  startDate?: Date | null;
  notes?: string | null;
};

export type ContractInput = {
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  shareModel: "PROFIT_SHARE" | "FIXED_FEE" | "FEE_PLUS_SHARE" | "REVENUE_SHARE";
  ownerSharePct: string;
  fixedFee: string;
  cogsBasis: "TRANSFER_PRICE" | "OWNER_COST";
  deductOperatingExpenses: boolean;
  shareLosses: boolean;
  cashCustody: "PARTNER" | "OWNER";
  settlementFrequency: "DAILY" | "WEEKLY" | "SEMI_MONTHLY" | "MONTHLY";
  reportingMethod?: "THEORETICAL" | "INVENTORY_COUNT";
  paymentTermsDays: number;
  supplyPaymentTermsDays: number;
  terms?: string | null;
};

export async function createPartner(actor: Actor, input: PartnerInput & { status?: PartnerStatus }) {
  return withTx(async (tx) => {
    const partner = await tx.partner.create({
      data: { ...input, code: await nextCode(tx, "PTR", 4), status: input.status ?? "PROSPECT" },
    });
    await ensurePartnerLocation(tx, partner.id);
    await audit(tx, { userId: actor.id, action: "CREATE", entityType: "Partner", entityId: partner.id, after: partner });
    return partner;
  });
}

export async function updatePartner(actor: Actor, id: string, input: PartnerInput) {
  return withTx(async (tx) => {
    const before = await tx.partner.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Partner");
    const after = await tx.partner.update({ where: { id }, data: input });
    await tx.location.updateMany({ where: { partnerId: id }, data: { name: after.businessName, address: after.address } });
    await audit(tx, { userId: actor.id, action: "UPDATE", entityType: "Partner", entityId: id, before, after });
    return after;
  });
}

const ALLOWED_TRANSITIONS: Record<PartnerStatus, PartnerStatus[]> = {
  PROSPECT: ["PENDING_APPROVAL", "TERMINATED"],
  PENDING_APPROVAL: ["ACTIVE", "PROSPECT", "TERMINATED"],
  ACTIVE: ["ON_HOLD", "TERMINATED"],
  ON_HOLD: ["ACTIVE", "TERMINATED"],
  TERMINATED: [],
};

export async function changePartnerStatus(actor: Actor, id: string, status: PartnerStatus, reason: string) {
  return withTx(async (tx) => {
    const p = await tx.partner.findUnique({ where: { id }, include: { machines: true } });
    if (!p) throw new NotFoundError("Partner");
    if (!ALLOWED_TRANSITIONS[p.status].includes(status)) throw new AppError(`Cannot change status from ${p.status} to ${status}.`);
    if (status === "ACTIVE") {
      const contract = await tx.partnerContract.findFirst({ where: { partnerId: id, isActive: true } });
      if (!contract) throw new AppError("Add a partnership contract before activating this partner.");
    }
    if (status === "TERMINATED" && p.machines.length) throw new AppError("Return or transfer all machines before terminating the partnership.");
    const after = await tx.partner.update({ where: { id }, data: { status, startDate: status === "ACTIVE" && !p.startDate ? new Date(new Date().toISOString().slice(0, 10)) : p.startDate } });
    if (status === "TERMINATED") await tx.user.updateMany({ where: { partnerId: id }, data: { isActive: false } });
    await audit(tx, { userId: actor.id, action: "STATUS_CHANGE", entityType: "Partner", entityId: id, summary: `${p.status} → ${status}: ${reason}`, before: { status: p.status }, after: { status } });
    return after;
  });
}

export function validateContract(input: ContractInput) {
  const pct = D(input.ownerSharePct);
  if (pct.isNegative() || pct.gt(100)) throw new AppError("Owner share must be between 0 and 100%.");
  if (D(input.fixedFee).isNegative()) throw new AppError("Fixed fee cannot be negative.");
  if ((input.shareModel === "FIXED_FEE" || input.shareModel === "FEE_PLUS_SHARE") && D(input.fixedFee).lte(0)) throw new AppError("This share model requires a fixed fee.");
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw new AppError("Contract end date must be after the start date.");
  if (input.paymentTermsDays < 0 || input.supplyPaymentTermsDays < 0) throw new AppError("Payment terms cannot be negative.");
}

/** Creates a new contract version. The previous active version is closed the day before the new one starts. */
export async function createContract(actor: Actor, partnerId: string, input: ContractInput) {
  validateContract(input);
  return withTx(async (tx) => {
    const partner = await tx.partner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new NotFoundError("Partner");
    const prev = await tx.partnerContract.findFirst({ where: { partnerId, isActive: true }, orderBy: { version: "desc" } });
    if (prev && input.effectiveFrom <= prev.effectiveFrom) throw new AppError("A new contract version must start after the current version's start date.");
    const last = await tx.partnerContract.aggregate({ where: { partnerId }, _max: { version: true } });
    if (prev) {
      await tx.partnerContract.update({ where: { id: prev.id }, data: { isActive: false, effectiveTo: prev.effectiveTo && prev.effectiveTo < input.effectiveFrom ? prev.effectiveTo : addDays(input.effectiveFrom, -1) } });
    }
    const pct = money(input.ownerSharePct);
    const contract = await tx.partnerContract.create({
      data: {
        partnerId, version: (last._max.version ?? 0) + 1, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null,
        shareModel: input.shareModel, ownerSharePct: pct.toString(), partnerSharePct: D(100).minus(pct).toString(), fixedFee: money(input.fixedFee).toString(),
        cogsBasis: input.cogsBasis, deductOperatingExpenses: input.deductOperatingExpenses, shareLosses: input.shareLosses, cashCustody: input.cashCustody,
        settlementFrequency: input.settlementFrequency, reportingMethod: input.reportingMethod ?? "INVENTORY_COUNT", paymentTermsDays: input.paymentTermsDays, supplyPaymentTermsDays: input.supplyPaymentTermsDays,
        terms: input.terms, createdById: actor.id,
      },
    });
    await audit(tx, { userId: actor.id, action: "CONTRACT_CREATE", entityType: "Partner", entityId: partnerId, summary: `Contract v${contract.version}`, before: prev, after: contract });
    return contract;
  });
}

/** The contract in force on a given date. */
export async function contractOn(db: Tx | typeof prisma, partnerId: string, date: Date) {
  return db.partnerContract.findFirst({
    where: { partnerId, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
    orderBy: { version: "desc" },
  });
}

export async function setProductPrice(actor: Actor, partnerId: string, productId: string, price: string | null) {
  return withTx(async (tx) => {
    const before = await tx.partnerProductPrice.findUnique({ where: { partnerId_productId: { partnerId, productId } } });
    let after: unknown = null;
    if (price === null || price === "") {
      if (before) after = await tx.partnerProductPrice.update({ where: { id: before.id }, data: { isActive: false } });
    } else {
      if (D(price).isNegative()) throw new AppError("Price cannot be negative.");
      after = await tx.partnerProductPrice.upsert({
        where: { partnerId_productId: { partnerId, productId } },
        create: { partnerId, productId, price: money(price).toString() },
        update: { price: money(price).toString(), isActive: true },
      });
    }
    await audit(tx, { userId: actor.id, action: "PRICE_UPDATE", entityType: "Partner", entityId: partnerId, summary: `Product ${productId}`, before, after });
  });
}

export async function createUser(actor: Actor, input: { email: string; name: string; password: string; role: Prisma.UserCreateInput["role"]; partnerId?: string | null }) {
  const problem = passwordProblem(input.password);
  if (problem) throw new AppError(problem);
  if (input.role === "PARTNER" && !input.partnerId) throw new AppError("Partner accounts must be linked to a partner.");
  if (input.role !== "PARTNER" && input.partnerId) throw new AppError("Only partner accounts can be linked to a partner.");
  if (input.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") throw new AppError("Only a Super Admin can create Super Admins.", 403);
  return withTx(async (tx) => {
    const email = input.email.toLowerCase().trim();
    if (await tx.user.findUnique({ where: { email } })) throw new AppError("A user with this email already exists.");
    const user = await tx.user.create({ data: { email, name: input.name, role: input.role, partnerId: input.partnerId ?? null, passwordHash: await hashPassword(input.password) } });
    await audit(tx, { userId: actor.id, action: "USER_CREATE", entityType: "User", entityId: user.id, after: { email, role: user.role, partnerId: user.partnerId } });
    return user;
  });
}

export async function setUserActive(actor: Actor, userId: string, isActive: boolean) {
  if (userId === actor.id) throw new AppError("You cannot deactivate your own account.");
  return withTx(async (tx) => {
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (u.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") throw new AppError("Only a Super Admin can change a Super Admin.", 403);
    await tx.user.update({ where: { id: userId }, data: { isActive } });
    if (!isActive) await tx.session.deleteMany({ where: { userId } });
    await audit(tx, { userId: actor.id, action: isActive ? "USER_ACTIVATE" : "USER_DEACTIVATE", entityType: "User", entityId: userId });
  });
}

export async function resetPassword(actor: Actor, userId: string, password: string) {
  const problem = passwordProblem(password);
  if (problem) throw new AppError(problem);
  return withTx(async (tx) => {
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (u.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") throw new AppError("Only a Super Admin can change a Super Admin.", 403);
    await tx.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null } });
    await tx.session.deleteMany({ where: { userId } });
    await audit(tx, { userId: actor.id, action: "PASSWORD_RESET", entityType: "User", entityId: userId });
  });
}
