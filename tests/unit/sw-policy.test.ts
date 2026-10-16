import { describe, it, expect } from "vitest";
import { routePolicy } from "../../public/sw-policy.js";

describe("sw routePolicy", () => {
  it("never caches api, ledger proxy, or data", () => {
    for (const u of [
      "https://x/api/tasks/sync",
      "https://x/ledger-app/index.html",
      "https://x/assets/app.js",
      "https://x/api/data/x",
      "https://x/api/ofx/x",
      "https://x/_next/data/abc.json",
    ]) {
      expect(routePolicy(u, "cors").strategy).toBe("network-only");
    }
  });
  it("cache-first for hashed static + icons + fonts", () => {
    expect(routePolicy("https://x/_next/static/chunk.js", "no-cors").strategy).toBe("cache-first");
    expect(routePolicy("https://x/icons/icon-192.png", "no-cors").strategy).toBe("cache-first");
    expect(routePolicy("https://x/fonts/a.woff2", "no-cors").strategy).toBe("cache-first");
  });
  it("navigations use the navigate strategy (offline fallback)", () => {
    expect(routePolicy("https://x/calendar", "navigate").strategy).toBe("navigate");
  });
  it("unknown GETs are network-first and cacheable", () => {
    const p = routePolicy("https://x/version.json", "no-cors");
    expect(p.strategy).toBe("network-first");
    expect(p.cacheable).toBe(true);
  });
});