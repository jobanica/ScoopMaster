import { prisma, withTx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import type { Actor } from "../actor";

export const DEFAULT_QR_PATH = "/payment/instapay-qr.png";
const KEYS = ["payment.qrStoredName", "payment.accountName", "payment.accountNumber", "payment.instructions"] as const;

export type PaymentSettings = { qrStoredName: string | null; accountName: string | null; accountNumber: string | null; instructions: string | null; qrUrl: string; custom: boolean };

/** How partners pay Scoop Master (QR code + account details), shown on the partner payment screens. */
export async function getPaymentSettings(): Promise<PaymentSettings> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [...KEYS] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value || null;
  const qrStoredName = get("payment.qrStoredName");
  return {
    qrStoredName,
    accountName: get("payment.accountName"),
    accountNumber: get("payment.accountNumber"),
    instructions: get("payment.instructions"),
    qrUrl: qrStoredName ? `/api/payment-qr?v=${encodeURIComponent(qrStoredName.slice(0, 8))}` : "/api/payment-qr",
    custom: !!qrStoredName,
  };
}

export async function savePaymentSettings(actor: Actor, input: { accountName: string | null; accountNumber: string | null; instructions: string | null; qrStoredName?: string | null; resetQr?: boolean }) {
  if ((input.accountName?.length ?? 0) > 120 || (input.accountNumber?.length ?? 0) > 60 || (input.instructions?.length ?? 0) > 600) throw new AppError("One of the fields is too long.");
  return withTx(async (tx) => {
    const set = async (key: string, value: string | null) => {
      if (value === null || value === "") await tx.appSetting.deleteMany({ where: { key } });
      else await tx.appSetting.upsert({ where: { key }, create: { key, value, updatedById: actor.id }, update: { value, updatedById: actor.id } });
    };
    await set("payment.accountName", input.accountName);
    await set("payment.accountNumber", input.accountNumber);
    await set("payment.instructions", input.instructions);
    if (input.qrStoredName) await set("payment.qrStoredName", input.qrStoredName);
    if (input.resetQr) await set("payment.qrStoredName", null);
    await audit(tx, { userId: actor.id, action: "PAYMENT_SETTINGS_UPDATE", entityType: "AppSetting", summary: input.qrStoredName ? "New payment QR uploaded" : input.resetQr ? "Payment QR reset to default" : "Payment details updated", after: { accountName: input.accountName, accountNumber: input.accountNumber } });
  });
}
