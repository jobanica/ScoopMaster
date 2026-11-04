import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
import { DEFAULT_ROLES, DEFAULT_THRESHOLDS } from "../src/server/services/notifications";

/** System configuration required for the app to run. Contains NO business/demo data. */
export async function seedCore(prisma: PrismaClient, opts: { adminEmail: string; adminPassword: string; adminName?: string; skipAdmin?: boolean }) {
  await prisma.location.upsert({ where: { code: "WH-MAIN" }, update: {}, create: { code: "WH-MAIN", name: "Main Warehouse", type: "WAREHOUSE" } });
  await prisma.location.upsert({ where: { code: "IN-TRANSIT" }, update: {}, create: { code: "IN-TRANSIT", name: "In Transit (dispatched, not yet received)", type: "IN_TRANSIT" } });

  for (const [type, roles] of Object.entries(DEFAULT_ROLES)) {
    const threshold = DEFAULT_THRESHOLDS[type as keyof typeof DEFAULT_THRESHOLDS];
    await prisma.notificationRule.upsert({
      where: { type: type as never },
      update: {},
      create: { type: type as never, roles, enabled: true, threshold: threshold ?? null, notifyPartner: ["PAYMENT_OVERDUE", "PAYMENT_DUE_SOON", "SETTLEMENT_READY"].includes(type) },
    });
  }

  if (opts.skipAdmin) return;
  const email = opts.adminEmail.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({ data: { email, name: opts.adminName ?? "Super Admin", role: "SUPER_ADMIN", passwordHash: await hashPassword(opts.adminPassword) } });
  }
}
