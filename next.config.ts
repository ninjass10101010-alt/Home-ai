import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async redirects() {
    return [
      {
        source: "/more",
        destination: "/calendar",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;