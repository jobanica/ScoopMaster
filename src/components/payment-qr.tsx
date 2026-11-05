import { Download, QrCode } from "lucide-react";
import { getPaymentSettings } from "@/server/services/settings";
import { Peso } from "./ui";
import type { DecimalLike } from "@/lib/money";

/** Scoop Master's payment QR (InstaPay / GCash) with a download button, shown on partner payment screens. */
export async function PaymentQr({ amount }: { amount?: DecimalLike }) {
  const s = await getPaymentSettings();
  const downloadHref = s.custom ? "/api/payment-qr?download=1" : "/payment/instapay-qr.png";
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-choco-50 px-4 py-3">
        <QrCode size={18} className="text-choco-600" />
        <h2 className="text-sm font-semibold text-choco-800">Scan to pay Scoop Master</h2>
      </div>
      <div className="p-4 text-center">
        {amount !== undefined && <p className="mb-2 text-sm text-choco-600">Amount to send: <Peso v={amount} className="text-lg font-bold text-choco-900" /></p>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={s.qrUrl} alt="Scoop Master InstaPay QR code" width={280} height={280} className="mx-auto h-auto w-full max-w-[280px] rounded-xl border border-choco-100 bg-white" />
        {(s.accountName || s.accountNumber) && (
          <p className="mt-3 text-sm">
            {s.accountName && <span className="block font-semibold text-choco-900">{s.accountName}</span>}
            {s.accountNumber && <span className="block tabular-nums text-choco-700">{s.accountNumber}</span>}
          </p>
        )}
        <a href={downloadHref} download="ScoopMaster-InstaPay-QR.png" className="btn-secondary mt-3 w-full sm:w-auto"><Download size={16} /> Download QR</a>
        <p className="mt-3 text-left text-xs text-choco-500">
          {s.instructions ?? "Open GCash, Maya or your bank app → Scan QR / InstaPay, or upload the downloaded QR from your gallery. After paying, enter the reference number below and attach a screenshot of the receipt."}
        </p>
      </div>
    </section>
  );
}
