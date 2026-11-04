import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/storage";
import { canViewAttachment } from "@/server/attachments";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a || !canViewAttachment(user, a)) return new NextResponse("Not found", { status: 404 });
  const buf = await readUpload(a.storedName);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": a.mimeType,
      "Content-Disposition": `${a.mimeType === "application/pdf" || a.mimeType.startsWith("image/") ? "inline" : "attachment"}; filename="${encodeURIComponent(a.fileName)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
