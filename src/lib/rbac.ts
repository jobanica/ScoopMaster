import type { Role } from "@prisma/client";

export const PERMISSIONS = [
  "dashboard:view",
  "dashboard:financials",
  "partners:read",
  "partners:write",
  "partners:status",
  "partners:confidential",
  "contracts:write",
  "machines:read",
  "machines:write",
  "maintenance:write",
  "sales:read",
  "sales:write",
  "sales:review",
  "inventory:read",
  "inventory:write",
  "inventory:items",
  "recipes:read",
  "recipes:write",
  "supply:read",
  "supply:review",
  "supply:fulfil",
  "finance:read",
  "finance:write",
  "payments:write",
  "payments:verify",
  "partnerExpenses:review",
  "settlements:read",
  "settlements:prepare",
  "settlements:approve",
  "reports:view",
  "reports:financial",
  "notifications:manage",
  "users:manage",
  "audit:read",
  "portal:access",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const STAFF_BASE: Permission[] = ["dashboard:view", "partners:read"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS.filter((p) => p !== "portal:access"),
  ADMIN: PERMISSIONS.filter((p) => !["portal:access", "users:manage"].includes(p)),
  FINANCE: [
    ...STAFF_BASE, "dashboard:financials", "machines:read", "sales:read", "inventory:read", "recipes:read", "supply:read",
    "finance:read", "finance:write", "payments:write", "payments:verify", "partnerExpenses:review",
    "settlements:read", "settlements:prepare", "reports:view", "reports:financial",
  ],
  WAREHOUSE: [
    ...STAFF_BASE, "inventory:read", "inventory:write", "inventory:items", "recipes:read",
    "supply:read", "supply:review", "supply:fulfil", "reports:view",
  ],
  OPERATIONS: [
    ...STAFF_BASE, "machines:read", "machines:write", "maintenance:write", "sales:read", "inventory:read",
    "recipes:read", "supply:read", "reports:view",
  ],
  PARTNER: ["portal:access"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  FINANCE: "Finance Staff",
  WAREHOUSE: "Warehouse Staff",
  OPERATIONS: "Operations Staff",
  PARTNER: "Partner",
};

export const STAFF_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "FINANCE", "WAREHOUSE", "OPERATIONS"];
