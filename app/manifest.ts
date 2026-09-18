import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NOVA — Your Personal Assistant",
    short_name: "NOVA",
    description: "NOVA makes sure you never forget anything important.",
    start_url: "/",
    display: "standalone",
    background_color: "#080D17",
    theme_color: "#080D17",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
