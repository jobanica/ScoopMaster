import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import type { SessionUser } from "@/lib/auth";
import type { Permission } from "@/lib/rbac";

export const ATTACHABLE: Record<string, { staffPerm: Permission; partnerCan: boolean }> = {
  Partner: { staffPerm: "partners:write", partnerCan: false },
  SalesReport: { staffPerm: "sales:write", partnerCan: true },
  Payment: { staffPerm: "payments:write", partnerCan: true },
  Invoice: { staffPerm: "finance:write", partnerCan: false },
  Bill: { staffPerm: "finance:write", partnerCan: false },
  PartnerExpense: { staffPerm: "partnerExpenses:review", partnerCan: true },
  MaintenanceRecord: { staffPerm: "maintenance:write", partnerCan: true },
  Machine: { staffPerm: "machines:write", partnerCan: false },
};

/** Returns the owning partnerId of an entity (null when none) or undefined when the entity does not exist. */
export async function entityPartnerId(entityType: string, entityId: string): Promise<string | null | undefined> {
  switch (entityType) {
    case "Partner": return (await prisma.partner.findUnique({ where: { id: entityId }, select: { id: true } }))?.id;
    case "SalesReport": return (await prisma.salesReport.findUnique({ where: { id: entityId }, select: { partnerId: true } }))?.partnerId;
    case "Payment": { const p = await prisma.payment.findUnique({ where: { id: entityId }, select: { partnerId: true } }); return p ? p.partnerId : undefined; }
    case "Invoice": { const p = await prisma.invoice.findUnique({ where: { id: entityId }, select: { partnerId: true } }); return p ? p.partnerId : undefined; }
    case "Bill": { const p = await prisma.bill.findUnique({ where: { id: entityId }, select: { partnerId: true } }); return p ? p.partnerId : undefined; }
    case "PartnerExpense": return (await prisma.partnerExpense.findUnique({ where: { id: entityId }, select: { partnerId: true } }))?.partnerId;
    case "MaintenanceRecord": { const p = await prisma.maintenanceRecord.findUnique({ where: { id: entityId }, select: { partnerId: true } }); return p ? p.partnerId : undefined; }
    case "Machine": { const p = await prisma.machine.findUnique({ where: { id: entityId }, select: { id: true } }); return p ? null : undefined; }
    default: return undefined;
  }
}

export function canViewAttachment(user: SessionUser, a: { partnerId: string | null; confidential: boolean }) {
  if (user.role === "PARTNER") return !!a.partnerId && a.partnerId === user.partnerId && !a.confidential;
  if (a.confidential) return can(user.role, "partners:confidential");
  return true;
}
