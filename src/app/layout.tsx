import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SCOOP MASTER", template: "%s · SCOOP MASTER" },
  description: "Soft-Serve Ice Cream Business Management System",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#523325" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-PH">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
