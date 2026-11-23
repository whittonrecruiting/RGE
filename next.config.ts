import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Resume uploads go through server actions; the default body limit is 1 MB, files may be 10 MB.
  // Next has no per-action or per-route limit (serverActions.bodySizeLimit is global), so it stays
  // at 11 MB for every action. Upload actions check the file size before reading it.
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  // Old section links keep working after the five-tab navigation change.
  async redirects() {
    return [
      { source: "/team", destination: "/settings#team", permanent: true },
      { source: "/sent", destination: "/campaign", permanent: true },
      { source: "/opt-outs", destination: "/campaign#opt-outs", permanent: true },
      { source: "/dashboard", destination: "/campaign", permanent: true },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
