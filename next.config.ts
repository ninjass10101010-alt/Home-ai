import type { NextConfig } from "next";

// Alex's finance app ("The Ledger") is proxied same-origin so it can be
// framed inside /ledger (its nginx sends X-Frame-Options: SAMEORIGIN) and
// gated by middleware for parents only. NAS: http://finance-dashboard (the
// container joins familydashboard_consuela-net — see DEPLOY_NAS_LOCAL.md);
// local dev runs on the Mac, which reaches the published port directly.
const FINANCE_DASHBOARD_URL = process.env.FINANCE_DASHBOARD_URL ?? "http://192.168.0.28:9080";

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
  async rewrites() {
    return [
      // The ledger SPA lives at its server root; /ledger-app/* is our mount.
      { source: "/ledger-app/:path*", destination: `${FINANCE_DASHBOARD_URL}/:path*` },
      // The app's absolute-path bundles and data calls (hashed build assets,
      // dashboard data, OFX statement import). Verified collision-free: this
      // app serves its own assets from /_next/static and never uses these.
      { source: "/assets/:path*", destination: `${FINANCE_DASHBOARD_URL}/assets/:path*` },
      { source: "/api/data/:path*", destination: `${FINANCE_DASHBOARD_URL}/api/data/:path*` },
      { source: "/api/ofx/:path*", destination: `${FINANCE_DASHBOARD_URL}/api/ofx/:path*` },
    ];
  },
};

export default nextConfig;
