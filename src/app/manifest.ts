import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Recruiter Growth Engine",
    short_name: "RGE",
    start_url: "/approvals",
    display: "standalone",
    theme_color: "#0A0A0A",
    background_color: "#0A0A0A",
    icons: [
      { src: "/brand/RGE-mark-128.png", sizes: "128x128", type: "image/png" },
      { src: "/brand/RGE-mark-256.png", sizes: "256x256", type: "image/png" },
      { src: "/brand/RGE-mark-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
