"use server";
import type { NotificationType, Role } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { safeAction } from "@/lib/action";
import { bool, email, oneOf, optStr, str } from "@/lib/form";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createUser, resetPassword, setUserActive } from "@/server/services/partners";

const STAFF = ["SUPER_ADMIN", "ADMIN", "FINANCE", "WAREHOUSE", "OPERATIONS"] as const;
export const createStaffAction = safeAction(async (fd) => {
  const user = await requireUser("users:manage");
  await createUser(user, { email: email(fd, "email")!, name: str(fd, "name", "Name"), password: str(fd, "password", "Password"), role: oneOf(fd, "role", STAFF) as Role });
  return { revalidate: ["/admin/users"], message: "User created." };
});
export const toggleUserAction = safeAction(async (fd) => {
  const user = await requireUser("users:manage");
  await setUserActive(user, str(fd, "id"), str(fd, "active") === "1");
  return { revalidate: ["/admin/users"], message: "User updated." };
});
export const resetPasswordAction = safeAction(async (fd) => {
  const user = await requireUser("users:manage");
  await resetPassword(user, str(fd, "id"), str(fd, "password", "New password"));
  return { revalidate: ["/admin/users"], message: "Password reset; the user's sessions were signed out." };
});
export const changeRoleAction = safeAction(async (fd) => {
  const user = await requireUser("users:manage");
  const id = str(fd, "id");
  const role = oneOf(fd, "role", STAFF) as Role;
  if (id === user.id) throw new AppError("You cannot change your own role.");
  const target = await prisma.user.findUniqueOrThrow({ where: { id } });
  if (target.role === "PARTNER") throw new AppError("Partner accounts cannot be converted to staff.");
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { role } }),
    prisma.session.deleteMany({ where: { userId: id } }),
    prisma.auditLog.create({ data: { userId: user.id, action: "ROLE_CHANGE", entityType: "User", entityId: id, summary: `${target.role} → ${role}` } }),
  ]);
  return { revalidate: ["/admin/users"], message: "Role changed." };
});
export const saveRuleAction = safeAction(async (fd) => {
  const user = await requireUser("notifications:manage");
  const type = str(fd, "type") as NotificationType;
  const roles = fd.getAll("roles").map(String).filter((r) => (STAFF as readonly string[]).includes(r)) as Role[];
  const t = optStr(fd, "threshold");
  if (t !== null && !/^\d+(\.\d+)?$/.test(t)) throw new AppError("Threshold must be a number.");
  const data = { enabled: bool(fd, "enabled"), roles, notifyPartner: bool(fd, "notifyPartner"), threshold: t };
  await prisma.$transaction([
    prisma.notificationRule.upsert({ where: { type }, create: { type, ...data }, update: data }),
    prisma.auditLog.create({ data: { userId: user.id, action: "RULE_UPDATE", entityType: "NotificationRule", entityId: type, after: data } }),
  ]);
  return { revalidate: ["/admin/notification-rules"], message: "Rule saved." };
});
