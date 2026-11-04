import { describe, it, expect } from "vitest";
import { can, ROLE_PERMISSIONS } from "@/lib/rbac";

describe("role-based access control", () => {
  it("partners only get portal access", () => {
    expect(ROLE_PERMISSIONS.PARTNER).toEqual(["portal:access"]);
    expect(can("PARTNER", "partners:read")).toBe(false);
    expect(can("PARTNER", "finance:read")).toBe(false);
  });
  it("only Super Admin and Admin can approve settlements", () => {
    expect(can("SUPER_ADMIN", "settlements:approve")).toBe(true);
    expect(can("ADMIN", "settlements:approve")).toBe(true);
    for (const r of ["FINANCE", "WAREHOUSE", "OPERATIONS", "PARTNER"] as const) expect(can(r, "settlements:approve")).toBe(false);
  });
  it("finance prepares settlements and manages payments; warehouse manages stock; operations manages machines", () => {
    expect(can("FINANCE", "settlements:prepare")).toBe(true);
    expect(can("FINANCE", "payments:verify")).toBe(true);
    expect(can("FINANCE", "inventory:write")).toBe(false);
    expect(can("WAREHOUSE", "inventory:write")).toBe(true);
    expect(can("WAREHOUSE", "supply:fulfil")).toBe(true);
    expect(can("WAREHOUSE", "finance:read")).toBe(false);
    expect(can("OPERATIONS", "maintenance:write")).toBe(true);
    expect(can("OPERATIONS", "dashboard:financials")).toBe(false);
  });
  it("only Super Admin manages users; staff never get portal access", () => {
    expect(can("SUPER_ADMIN", "users:manage")).toBe(true);
    expect(can("ADMIN", "users:manage")).toBe(false);
    for (const r of ["SUPER_ADMIN", "ADMIN", "FINANCE", "WAREHOUSE", "OPERATIONS"] as const) expect(can(r, "portal:access")).toBe(false);
  });
});
