import type { MetadataRoute } from "next";

// Lets partners "Add to Home Screen" and open the portal full-screen like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scoop Master",
    short_name: "Scoop Master",
    description: "Your Partner in Every Scoop. Open shift, closing count, supplies and statements.",
    start_url: "/portal",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FFF8EC",
    theme_color: "#3E261B",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
