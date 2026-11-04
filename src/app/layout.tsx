import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SCOOP MASTER", template: "%s · SCOOP MASTER" },
  description: "Soft-Serve Ice Cream Business Management System",
  applicationName: "Scoop Master",
  appleWebApp: { capable: true, title: "Scoop Master", statusBarStyle: "black-translucent" },
  icons: { icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }], apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }] },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#3E261B" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-PH">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
