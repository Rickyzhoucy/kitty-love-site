import type { NextConfig } from "next";

const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://localhost:8000";
const petAssetInternalUrl = process.env.PET_ASSET_INTERNAL_URL ?? "http://localhost:9000";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiInternalUrl}/api/v1/:path*`,
      },
      {
        source: "/pet-content/:path*",
        destination: `${petAssetInternalUrl}/pet-assets/:path*`,
      },
    ];
  },
};

export default nextConfig;
