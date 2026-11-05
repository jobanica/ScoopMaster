import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readUpload } from "@/lib/storage";
import { DEFAULT_QR_PATH, getPaymentSettings } from "@/server/services/settings";

/** The QR code partners scan to pay Scoop Master. ?download=1 saves it as a file. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const download = req.nextUrl.searchParams.get("download") === "1";
  const s = await getPaymentSettings();
  if (!s.qrStoredName) {
    const res = NextResponse.redirect(new URL(DEFAULT_QR_PATH, req.url));
    return res;
  }
  const buf = await readUpload(s.qrStoredName);
  const type = s.qrStoredName.endsWith(".png") ? "image/png" : s.qrStoredName.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=300",
      ...(download ? { "Content-Disposition": `attachment; filename="ScoopMaster-payment-QR.${type.split("/")[1].replace("jpeg", "jpg")}"` } : {}),
    },
  });
}
