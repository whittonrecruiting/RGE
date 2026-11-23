import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Resume uploads go through server actions; the default body limit is 1 MB, files may be 10 MB.
  // Next has no per-action or per-route limit (serverActions.bodySizeLimit is global), so it stays
  // at 11 MB for every action. Upload actions check the file size before reading it.
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  // Old section links keep working after the five-tab navigation change. Temporary (307), so
  // browsers do not cache them and the paths stay free to reuse.
  async redirects() {
    return [
      { source: "/team", destination: "/settings#team", permanent: false },
      { source: "/sent", destination: "/campaign", permanent: false },
      { source: "/opt-outs", destination: "/campaign#opt-outs", permanent: false },
      { source: "/dashboard", destination: "/campaign", permanent: false },
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
