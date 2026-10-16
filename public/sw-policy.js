// Pure SW routing policy — imported by sw.js (module worker) and by vitest.
// Keep dependency-free: it must load in both a worker and Node.
export function routePolicy(url, mode) {
  if (mode === "navigate") return { strategy: "navigate", cacheable: false };
  let pathname = "/";
  try {
    pathname = new URL(url).pathname;
  } catch {
    return { strategy: "network-only", cacheable: false };
  }
  const NEVER = [
    /^\/api\//,
    /^\/ledger-app\//,
    /^\/assets\//,
    /^\/api\/data\//,
    /^\/api\/ofx\//,
    /^\/_next\/data\//,
  ];
  if (NEVER.some((re) => re.test(pathname))) return { strategy: "network-only", cacheable: false };
  if (
    /^\/_next\/static\//.test(pathname) ||
    /^\/icons\//.test(pathname) ||
    /\.(?:woff2?|ttf|otf)$/.test(pathname)
  ) {
    return { strategy: "cache-first", cacheable: true };
  }
  return { strategy: "network-first", cacheable: true };
}