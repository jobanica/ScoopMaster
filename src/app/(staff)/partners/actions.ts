"use server";
import { requireUser } from "@/lib/auth";
import { safeAction } from "@/lib/action";
import { amount, bool, date, email, int, oneOf, optDate, optStr, str } from "@/lib/form";
import { createContract, createPartner, updatePartner, changePartnerStatus, setProductPrice, createUser } from "@/server/services/partners";
import { setCountProduct } from "@/server/services/sales";
import type { PartnerStatus } from "@prisma/client";

function partnerInput(fd: FormData) {
  return {
    businessName: str(fd, "businessName", "Business name"),
    ownerName: str(fd, "ownerName", "Owner's name"),
    contactNumber: optStr(fd, "contactNumber"),
    email: email(fd, "email", { optional: true }),
    address: optStr(fd, "address"),
    area: optStr(fd, "area"),
    startDate: optDate(fd, "startDate", "Start date"),
    notes: optStr(fd, "notes"),
  };
}

export const createPartnerAction = safeAction(async (fd) => {
  const user = await requireUser("partners:write");
  const p = await createPartner(user, { ...partnerInput(fd), status: oneOf(fd, "status", ["PROSPECT", "PENDING_APPROVAL"] as const, "Status") });
  return `/partners/${p.id}?tab=contract`;
});

export const updatePartnerAction = safeAction(async (fd) => {
  const user = await requireUser("partners:write");
  const id = str(fd, "id");
  await updatePartner(user, id, partnerInput(fd));
  return `/partners/${id}`;
});

const STATUSES = ["PROSPECT", "PENDING_APPROVAL", "ACTIVE", "ON_HOLD", "TERMINATED"] as const;
export const changeStatusAction = safeAction(async (fd) => {
  const user = await requireUser("partners:status");
  const id = str(fd, "id");
  await changePartnerStatus(user, id, oneOf(fd, "status", STATUSES) as PartnerStatus, str(fd, "reason", "Reason"));
  return { revalidate: [`/partners/${id}`], message: "Status updated." };
});

export const createContractAction = safeAction(async (fd) => {
  const user = await requireUser("contracts:write");
  const id = str(fd, "partnerId");
  await createContract(user, id, {
    effectiveFrom: date(fd, "effectiveFrom", "Effective from"),
    effectiveTo: optDate(fd, "effectiveTo", "Effective to"),
    shareModel: oneOf(fd, "shareModel", ["PROFIT_SHARE", "FIXED_FEE", "FEE_PLUS_SHARE", "REVENUE_SHARE"] as const),
    ownerSharePct: amount(fd, "ownerSharePct", "Owner share %"),
    fixedFee: amount(fd, "fixedFee", "Fixed fee", { optional: true }),
    cogsBasis: oneOf(fd, "cogsBasis", ["TRANSFER_PRICE", "OWNER_COST"] as const),
    deductOperatingExpenses: bool(fd, "deductOperatingExpenses"),
    shareLosses: bool(fd, "shareLosses"),
    cashCustody: oneOf(fd, "cashCustody", ["PARTNER", "OWNER"] as const),
    settlementFrequency: oneOf(fd, "settlementFrequency", ["DAILY", "WEEKLY", "SEMI_MONTHLY", "MONTHLY"] as const),
    reportingMethod: oneOf(fd, "reportingMethod", ["INVENTORY_COUNT", "THEORETICAL"] as const, "Sales reporting method"),
    paymentTermsDays: int(fd, "paymentTermsDays", "Payment terms", { min: 0, max: 365 }),
    supplyPaymentTermsDays: int(fd, "supplyPaymentTermsDays", "Supply payment terms", { min: 0, max: 365 }),
    terms: optStr(fd, "terms"),
  });
  return { revalidate: [`/partners/${id}`], message: "New contract version saved." };
});

export const setPriceAction = safeAction(async (fd) => {
  const user = await requireUser("contracts:write");
  const partnerId = str(fd, "partnerId");
  const productId = str(fd, "productId");
  const price = optStr(fd, "price");
  await setProductPrice(user, partnerId, productId, price ? amount(fd, "price", "Price") : null);
  return { revalidate: [`/partners/${partnerId}`], message: price ? "Price saved." : "Using default price." };
});

export const createPartnerUserAction = safeAction(async (fd) => {
  const user = await requireUser("partners:write");
  const partnerId = str(fd, "partnerId");
  await createUser(user, { email: email(fd, "email")!, name: str(fd, "name", "Name"), password: str(fd, "password", "Password"), role: "PARTNER", partnerId });
  return { revalidate: [`/partners/${partnerId}`], message: "Partner login created. Share the password securely." };
});

export const setCountProductAction = safeAction(async (fd) => {
  const user = await requireUser("contracts:write");
  const partnerId = str(fd, "partnerId");
  await setCountProduct(user, partnerId, str(fd, "itemId"), optStr(fd, "productId"));
  return { revalidate: [`/partners/${partnerId}`], message: "Saved." };
});
