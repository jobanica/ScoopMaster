import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { runScheduledChecks } from "@/server/services/alerts";

/** Call from a scheduler (e.g. every hour): curl -H "Authorization: Bearer $CRON_SECRET" https://host/api/cron/alerts */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.json({ ok: true, created: await runScheduledChecks() });
}
export const GET = POST;
