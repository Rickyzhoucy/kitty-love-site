import type { NextConfig } from "next";

const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://localhost:8000";
const petAssetInternalUrl = process.env.PET_ASSET_INTERNAL_URL ?? "http://localhost:9000";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        // 旧站文件名自带时间戳/摘要，内容不会原地替换。private 只让当前设备缓存，
        // 不允许共享代理缓存两个人的历史照片。
        source: "/uploads/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, max-age=86400, immutable",
          },
        ],
      },
    ];
  },
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
