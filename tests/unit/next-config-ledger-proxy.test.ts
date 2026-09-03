import { describe, it, expect, afterEach, vi } from "vitest";

async function loadConfig() {
  vi.resetModules();
  const mod = await import("../../next.config");
  return mod.default as {
    rewrites: () => Promise<Array<{ source: string; destination: string }>>;
  };
}

describe("ledger proxy rewrites", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("proxies the four ledger prefixes in order", async () => {
    const config = await loadConfig();
    const rules = await config.rewrites();
    expect(rules.map((r) => r.source)).toEqual([
      "/ledger-app/:path*",
      "/assets/:path*",
      "/api/data/:path*",
      "/api/ofx/:path*",
    ]);
  });

  it("defaults to the LAN URL and honors FINANCE_DASHBOARD_URL", async () => {
    let config = await loadConfig();
    let rules = await config.rewrites();
    expect(rules[0].destination).toBe("http://192.168.0.28:9080/:path*");
    expect(rules[2].destination).toBe("http://192.168.0.28:9080/api/data/:path*");

    vi.stubEnv("FINANCE_DASHBOARD_URL", "http://finance-dashboard");
    config = await loadConfig();
    rules = await config.rewrites();
    expect(rules[0].destination).toBe("http://finance-dashboard/:path*");
  });

  it("keeps the existing /more → /calendar redirect", async () => {
    const config = await loadConfig();
    const redirects = await (config as any).redirects();
    expect(redirects).toContainEqual({ source: "/more", destination: "/calendar", permanent: true });
  });
});
