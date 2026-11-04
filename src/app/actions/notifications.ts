"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { safeAction } from "@/lib/action";
import { prisma } from "@/lib/db";
import { runScheduledChecks } from "@/server/services/alerts";

export const markAllReadAction = safeAction(async () => {
  const user = await requireUser();
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
  return { message: "All notifications marked as read." };
});

export async function openNotification(fd: FormData) {
  const user = await requireUser();
  const id = String(fd.get("id"));
  const n = await prisma.notification.findFirst({ where: { id, userId: user.id } });
  if (!n) return;
  await prisma.notification.update({ where: { id }, data: { readAt: n.readAt ?? new Date() } });
  const { redirect } = await import("next/navigation");
  redirect(n.link && n.link.startsWith("/") ? n.link : user.role === "PARTNER" ? "/portal/notifications" : "/notifications");
}

export const runChecksAction = safeAction(async () => {
  await requireUser("notifications:manage");
  const c = await runScheduledChecks();
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  revalidatePath("/", "layout");
  return { message: `Checks complete: ${total} new notification(s).` };
});
