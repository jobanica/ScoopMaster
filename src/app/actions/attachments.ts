"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { safeAction } from "@/lib/action";
import { AppError, ForbiddenError } from "@/lib/errors";
import { storeUpload } from "@/lib/storage";
import { ATTACHABLE, entityPartnerId } from "@/server/attachments";

export const uploadAttachment = safeAction(async (fd) => {
  const user = await requireUser();
  const entityType = String(fd.get("entityType") ?? "");
  const entityId = String(fd.get("entityId") ?? "");
  const rule = ATTACHABLE[entityType];
  if (!rule) throw new AppError("Attachments are not supported here.");
  const partnerId = await entityPartnerId(entityType, entityId);
  if (partnerId === undefined) throw new AppError("Record not found.");
  const confidential = fd.get("confidential") === "on";
  if (user.role === "PARTNER") {
    if (!rule.partnerCan || partnerId !== user.partnerId || confidential) throw new ForbiddenError();
  } else if (!can(user.role, rule.staffPerm) || (confidential && !can(user.role, "partners:confidential"))) {
    throw new ForbiddenError();
  }
  const file = fd.get("file");
  if (!(file instanceof File)) throw new AppError("Choose a file to upload.");
  const stored = await storeUpload(file);
  const category = String(fd.get("category") || "GENERAL").replace(/[^A-Z_]/g, "").slice(0, 40) || "GENERAL";
  await prisma.$transaction(async (tx) => {
    const a = await tx.attachment.create({ data: { ...stored, entityType, entityId, partnerId, category, confidential, uploadedById: user.id } });
    await tx.auditLog.create({ data: { userId: user.id, action: "ATTACHMENT_UPLOAD", entityType, entityId, summary: `${a.fileName} (${category})` } });
  });
  const back = String(fd.get("back") ?? "");
  if (back.startsWith("/")) revalidatePath(back);
  return { message: "File uploaded." };
});
