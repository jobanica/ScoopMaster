import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "node:crypto";
import type { Role } from "@prisma/client";
import { prisma } from "./db";
import { can, type Permission } from "./rbac";
import { ForbiddenError } from "./errors";
import { hashPassword, verifyPassword } from "./password";

export const SESSION_COOKIE = "sm_session";
const SESSION_HOURS = 12;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  partnerId: string | null;
};

let _dummy: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  _dummy ??= hashPassword("timing-equalisation-only");
  return _dummy;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function login(email: string, password: string): Promise<{ ok: true; role: Role } | { ok: false; error: string }> {
  const generic = "Invalid email or password.";
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !user.isActive) {
    await verifyPassword(password, await dummyHash()); // equalise timing for unknown accounts
    return { ok: false, error: generic };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, error: "Account temporarily locked after repeated failed logins. Try again later." };
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000) : null },
    });
    await prisma.auditLog.create({ data: { userId: user.id, action: "LOGIN_FAILED", entityType: "User", entityId: user.id } });
    return { ok: false, error: generic };
  }
  if (user.role === "PARTNER" && !user.partnerId) return { ok: false, error: "Partner account is not linked to a partner." };

  const token = crypto.randomBytes(32).toString("base64url");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await prisma.$transaction([
    prisma.session.create({
      data: { tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_HOURS * 3600000), ip, userAgent: h.get("user-agent")?.slice(0, 255) },
    }),
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } }),
    prisma.auditLog.create({ data: { userId: user.id, action: "LOGIN", entityType: "User", entityId: user.id, ip } }),
  ]);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_HOURS * 3600,
  });
  return { ok: true, role: user.role };
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;
  const u = session.user;
  return { id: u.id, name: u.name, email: u.email, role: u.role, partnerId: u.partnerId };
});

/** For pages: redirects to /login when signed out, or to the right home when unauthorised. */
export async function requirePage(permission?: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (permission && !can(user.role, permission)) redirect(user.role === "PARTNER" ? "/portal" : "/dashboard?denied=1");
  return user;
}

/** For server actions / API routes: throws instead of redirecting. */
export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new ForbiddenError("Your session has expired. Please sign in again.");
  if (permission && !can(user.role, permission)) throw new ForbiddenError();
  return user;
}

/** Partner portal guard: returns the user and their partnerId (never trust a partnerId from the client). */
export async function requirePartner(): Promise<SessionUser & { partnerId: string }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "PARTNER" || !user.partnerId) redirect("/dashboard");
  return user as SessionUser & { partnerId: string };
}

export async function requirePartnerAction(): Promise<SessionUser & { partnerId: string }> {
  const user = await requireUser("portal:access");
  if (!user.partnerId) throw new ForbiddenError();
  return user as SessionUser & { partnerId: string };
}
