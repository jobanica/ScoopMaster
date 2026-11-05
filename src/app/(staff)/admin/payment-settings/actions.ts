"use server";
import { requireUser } from "@/lib/auth";
import { safeAction } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { optStr } from "@/lib/form";
import { storeUpload } from "@/lib/storage";
import { savePaymentSettings } from "@/server/services/settings";

export const savePaymentSettingsAction = safeAction(async (fd) => {
  const user = await requireUser("finance:write");
  const file = fd.get("qr");
  let qrStoredName: string | null = null;
  if (file instanceof File && file.size > 0) {
    const stored = await storeUpload(file);
    if (stored.mimeType === "application/pdf") throw new AppError("Upload the QR code as an image (PNG or JPEG), not a PDF.");
    qrStoredName = stored.storedName;
  }
  await savePaymentSettings(user, { accountName: optStr(fd, "accountName"), accountNumber: optStr(fd, "accountNumber"), instructions: optStr(fd, "instructions"), qrStoredName, resetQr: fd.get("resetQr") === "on" });
  return { revalidate: ["/admin/payment-settings"], message: "Payment details saved. Partners now see them on their payment screen." };
});
