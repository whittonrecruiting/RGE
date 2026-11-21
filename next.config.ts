import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Resume uploads go through server actions; the default body limit is 1 MB, files may be 10 MB.
  // Next has no per-action or per-route limit (serverActions.bodySizeLimit is global), so it stays
  // at 11 MB for every action. Upload actions check the file size before reading it.
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
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
