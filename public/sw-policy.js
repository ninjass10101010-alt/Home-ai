// Pure SW routing policy — imported by sw.js (module worker) and by vitest.
// Keep dependency-free: it must load in both a worker and Node.
export function routePolicy(url, mode) {
  if (mode === "navigate") return { strategy: "navigate", cacheable: false };
  let pathname = "/";
  let search = "";
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname;
    search = parsed.search;
  } catch {
    return { strategy: "network-only", cacheable: false };
  }
  // Next.js App Router RSC payloads (_rsc query param) must be network-only,
  // same as the legacy Pages router /_next/data/ queries.
  if (search && /[?&]_rsc=/.test(search)) {
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