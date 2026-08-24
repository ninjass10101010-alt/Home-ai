import { describe, it, expect, vi, afterEach } from "vitest";
import { isCronAuthorized } from "../../src/lib/cron-auth";

function req(authHeader?: string): Request {
  return new Request("http://localhost/api/cron/x", {
    method: "POST",
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isCronAuthorized", () => {
  it("accepts the exact bearer token when CRON_SECRET is set", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(isCronAuthorized(req("Bearer s3cret"))).toBe(true);
  });

  it("fails closed when CRON_SECRET is unset — even for the literal 'Bearer undefined'", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(isCronAuthorized(req("Bearer undefined"))).toBe(false);
    expect(isCronAuthorized(req(undefined))).toBe(false);
    expect(isCronAuthorized(req("Bearer s3cret"))).toBe(false);
  });

  it("rejects wrong tokens, missing headers and malformed values", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(isCronAuthorized(req("Bearer wrong"))).toBe(false);
    expect(isCronAuthorized(req(undefined))).toBe(false);
    expect(isCronAuthorized(req("s3cret"))).toBe(false);
    expect(isCronAuthorized(req("bearer s3cret"))).toBe(false);
    expect(isCronAuthorized(req("Bearer s3cret extra"))).toBe(false);
  });
});
