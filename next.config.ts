import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Resume uploads go through server actions; the default body limit is 1 MB, files may be 10 MB.
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
