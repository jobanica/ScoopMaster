import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { rangeParams } from "@/lib/params";
import { getReport } from "@/server/reports";
import { reportToPDF, toCSV, toXLSX } from "@/server/export";

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const def = getReport((await params).key);
  if (!def) return new NextResponse("Not found", { status: 404 });
  if (!can(user.role, def.permission)) return new NextResponse("Forbidden", { status: 403 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const r = rangeParams(sp);
  const partnerId = def.usesPartner ? sp.partnerId || undefined : undefined;
  const result = await def.run({ from: r.from, to: r.to, partnerId });
  const partner = partnerId ? await prisma.partner.findUnique({ where: { id: partnerId } }) : null;
  const subtitle = `${def.usesRange ? `${r.fromText} – ${r.toText}` : `As of ${r.toText}`}${partner ? ` · ${partner.businessName}` : ""} · Amounts in PHP`;
  const base = `scoopmaster-${def.key}-${r.fromText.replace(/\//g, "")}-${r.toText.replace(/\//g, "")}`;
  await prisma.auditLog.create({ data: { userId: user.id, action: "REPORT_EXPORT", entityType: "Report", entityId: def.key, summary: `${sp.format ?? "csv"} ${subtitle}` } });
  switch (sp.format) {
    case "xlsx":
      return new NextResponse(new Uint8Array(await toXLSX(def.title, subtitle, result)), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"` } });
    case "pdf":
      return new NextResponse(new Uint8Array(reportToPDF(def.title, subtitle, result)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` } });
    default:
      return new NextResponse(toCSV(result), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` } });
  }
}
