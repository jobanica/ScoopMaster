import type { NotificationType, Role, Severity } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";

type Note = { title: string; body?: string; link?: string; severity?: Severity; dedupeKey?: string };

const DEFAULT_ROLES: Record<NotificationType, Role[]> = {
  MISSING_SALES_REPORT: ["SUPER_ADMIN", "ADMIN", "OPERATIONS"],
  LOW_STOCK: ["SUPER_ADMIN", "ADMIN", "WAREHOUSE"],
  EXPIRING_STOCK: ["SUPER_ADMIN", "ADMIN", "WAREHOUSE"],
  SUPPLY_REQUEST: ["SUPER_ADMIN", "ADMIN", "WAREHOUSE"],
  PAYMENT_SUBMITTED: ["SUPER_ADMIN", "ADMIN", "FINANCE"],
  PAYMENT_OVERDUE: ["SUPER_ADMIN", "ADMIN", "FINANCE"],
  PAYMENT_DUE_SOON: ["SUPER_ADMIN", "FINANCE"],
  MAINTENANCE_DUE: ["SUPER_ADMIN", "ADMIN", "OPERATIONS"],
  MACHINE_PROBLEM: ["SUPER_ADMIN", "ADMIN", "OPERATIONS"],
  SALES_DROP: ["SUPER_ADMIN", "ADMIN", "OPERATIONS"],
  CASH_DISCREPANCY: ["SUPER_ADMIN", "ADMIN", "FINANCE"],
  SETTLEMENT_READY: ["SUPER_ADMIN", "ADMIN"],
  CONTRACT_EXPIRING: ["SUPER_ADMIN", "ADMIN"],
  SALES_SUBMITTED: ["ADMIN"],
  EDIT_REQUEST: ["SUPER_ADMIN", "ADMIN"],
  GENERAL: ["SUPER_ADMIN", "ADMIN"],
};

export const DEFAULT_THRESHOLDS: Partial<Record<NotificationType, number>> = {
  EXPIRING_STOCK: 30, // days
  PAYMENT_DUE_SOON: 3, // days
  SALES_DROP: 30, // percent drop vs previous 7-day average
  CASH_DISCREPANCY: 1, // pesos tolerance
  CONTRACT_EXPIRING: 30, // days
  MAINTENANCE_DUE: 7, // days
  MISSING_SALES_REPORT: 1, // days late
};

export async function getRule(type: NotificationType, db: Tx | typeof prisma = prisma) {
  const rule = await db.notificationRule.findUnique({ where: { type } });
  return {
    enabled: rule?.enabled ?? true,
    roles: rule?.roles?.length ? rule.roles : DEFAULT_ROLES[type],
    notifyPartner: rule?.notifyPartner ?? ["PAYMENT_OVERDUE", "PAYMENT_DUE_SOON", "SETTLEMENT_READY"].includes(type),
    threshold: rule?.threshold != null ? Number(rule.threshold) : DEFAULT_THRESHOLDS[type] ?? 0,
  };
}

export { DEFAULT_ROLES };

async function deliver(db: Tx | typeof prisma, userIds: string[], type: NotificationType, n: Note) {
  if (!userIds.length) return 0;
  const res = await db.notification.createMany({
    data: userIds.map((userId) => ({ userId, type, title: n.title, body: n.body, link: n.link, severity: n.severity ?? "INFO", dedupeKey: n.dedupeKey })),
    skipDuplicates: true, // (userId, dedupeKey) unique → no repeated alerts
  });
  return res.count;
}

/** Notify staff by rule-configured roles (and optionally the partner's users). */
export async function notify(type: NotificationType, n: Note & { partnerId?: string | null; partnerLink?: string }, db: Tx | typeof prisma = prisma) {
  const rule = await getRule(type, db);
  if (!rule.enabled) return 0;
  const staff = await db.user.findMany({ where: { role: { in: rule.roles.filter((r) => r !== "PARTNER") }, isActive: true }, select: { id: true } });
  let count = await deliver(db, staff.map((u) => u.id), type, n);
  if (rule.notifyPartner && n.partnerId) {
    const pu = await db.user.findMany({ where: { partnerId: n.partnerId, role: "PARTNER", isActive: true }, select: { id: true } });
    count += await deliver(db, pu.map((u) => u.id), type, { ...n, link: n.partnerLink ?? "/portal/notifications" });
  }
  return count;
}

/** Notify a partner's own users regardless of staff rules (e.g. their request was approved). */
export async function notifyPartner(partnerId: string, type: NotificationType, n: Note, db: Tx | typeof prisma = prisma) {
  const pu = await db.user.findMany({ where: { partnerId, role: "PARTNER", isActive: true }, select: { id: true } });
  return deliver(db, pu.map((u) => u.id), type, n);
}
