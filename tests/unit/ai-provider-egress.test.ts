import { describe, it, expect } from "vitest";
import {
  parseProviderBaseUrl,
  isSameProviderEndpoint,
  resolveEgressTarget,
  redactUpstreamText,
} from "@/lib/ai/provider-egress";

// Fake credential shapes only — never a real key.
const STORED_KEY = "test-key-placeholder";

describe("parseProviderBaseUrl", () => {
  it("accepts an absolute http(s) URL and exposes its host", () => {
    const parsed = parseProviderBaseUrl("https://api.b.ai/v1/");
    expect(parsed?.url).toBe("https://api.b.ai/v1");
    expect(parsed?.host).toBe("https://api.b.ai");
  });

  it("keeps scheme and an explicit port so two gateways on one IP stay distinct", () => {
    expect(parseProviderBaseUrl("http://router.internal:8080")?.host).toBe("http://router.internal:8080");
  });

  it("rejects anything that is not a plain absolute http(s) URL", () => {
    for (const bad of [
      "",
      "   ",
      "api.b.ai",
      "/v1/models",
      "ftp://api.b.ai",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/plain,hi",
      "//api.b.ai",
      "http://",
      "https://user:pass@api.b.ai", // embedded credentials could smuggle a secret into a URL
    ]) {
      expect(parseProviderBaseUrl(bad), bad).toBeNull();
    }
  });
});

describe("isSameProviderEndpoint", () => {
  it("treats case, default port and a trailing /v1 as the same endpoint", () => {
    expect(isSameProviderEndpoint("https://API.b.ai", "https://api.b.ai/v1")).toBe(true);
    expect(isSameProviderEndpoint("https://api.b.ai:443", "https://api.b.ai")).toBe(true);
  });

  it("treats a different host, port or path as a different endpoint", () => {
    expect(isSameProviderEndpoint("https://api.b.ai", "https://attacker.example")).toBe(false);
    expect(isSameProviderEndpoint("https://api.b.ai", "http://api.b.ai")).toBe(false);
    expect(isSameProviderEndpoint("https://api.b.ai", "https://api.b.ai:8443")).toBe(false);
    expect(isSameProviderEndpoint("https://api.b.ai/openai", "https://api.b.ai")).toBe(false);
    // Subdomain suffix games are NOT the same host.
    expect(isSameProviderEndpoint("https://api.b.ai", "https://api.b.ai.attacker.example")).toBe(false);
    expect(isSameProviderEndpoint("https://api.b.ai", "https://attacker.example/?x=api.b.ai")).toBe(false);
  });
});

describe("resolveEgressTarget — a stored key only ever reaches its own provider", () => {
  const providers = [
    { id: "1", baseUrl: "https://api.b.ai", apiKey: STORED_KEY },
    { id: "2", baseUrl: "https://router.internal", apiKey: null },
  ];

  it("binds the stored key to the stored endpoint and ignores a matching override", () => {
    const d = resolveEgressTarget({
      providerId: "1",
      requestedBaseUrl: "https://api.b.ai",
      postedApiKey: "",
      providers,
    });
    expect(d).toEqual({ ok: true, baseUrl: "https://api.b.ai", key: STORED_KEY, keySource: "stored" });
  });

  it("works with the endpoint omitted entirely (the client need not echo the URL)", () => {
    const d = resolveEgressTarget({ providerId: "1", requestedBaseUrl: "", postedApiKey: "", providers });
    expect(d).toMatchObject({ ok: true, baseUrl: "https://api.b.ai", keySource: "stored" });
  });

  // The P1 bug: stored key + attacker-chosen baseUrl.
  it("REFUSES to send the stored key to a caller-supplied host", () => {
    const d = resolveEgressTarget({
      providerId: "1",
      requestedBaseUrl: "https://attacker.example/collect",
      postedApiKey: "",
      providers,
    });
    expect(d.ok).toBe(false);
    if (d.ok) throw new Error("unreachable");
    expect(d.status).toBe(409);
    expect(d.error).toBe("stored_key_endpoint_conflict");
    expect(JSON.stringify(d)).not.toContain(STORED_KEY);
  });

  it("REFUSES a host that merely looks like the provider (suffix / query games)", () => {
    for (const host of [
      "https://api.b.ai.attacker.example",
      "https://attacker.example/api.b.ai",
      "https://attacker.example/?u=https://api.b.ai",
    ]) {
      const d = resolveEgressTarget({ providerId: "1", requestedBaseUrl: host, postedApiKey: "", providers });
      expect(d.ok, host).toBe(false);
    }
  });

  it("never loads the stored key when a typed key targets a different endpoint", () => {
    const d = resolveEgressTarget({
      providerId: "1",
      requestedBaseUrl: "https://new-gateway.example",
      postedApiKey: "typed-key-placeholder",
      providers,
    });
    expect(d).toEqual({
      ok: true,
      baseUrl: "https://new-gateway.example",
      key: "typed-key-placeholder",
      keySource: "posted",
    });
    expect(JSON.stringify(d)).not.toContain(STORED_KEY);
  });

  it("prefers a typed key over the stored one on the provider's own endpoint", () => {
    const d = resolveEgressTarget({
      providerId: "1",
      requestedBaseUrl: "https://api.b.ai",
      postedApiKey: "typed-key-placeholder",
      providers,
    });
    expect(d).toMatchObject({ ok: true, key: "typed-key-placeholder", keySource: "posted" });
    expect(JSON.stringify(d)).not.toContain(STORED_KEY);
  });

  it("probes a keyless provider unkeyed on its own endpoint", () => {
    const d = resolveEgressTarget({ providerId: "2", requestedBaseUrl: "", postedApiKey: "", providers });
    expect(d).toEqual({ ok: true, baseUrl: "https://router.internal", key: null, keySource: "none" });
  });

  it("still refuses to retarget a keyless provider to another host", () => {
    const d = resolveEgressTarget({
      providerId: "2",
      requestedBaseUrl: "https://attacker.example",
      postedApiKey: "",
      providers,
    });
    expect(d.ok).toBe(false);
  });

  it("treats an unsaved draft (no providerId) as caller-owned: typed key to the typed host", () => {
    const d = resolveEgressTarget({
      providerId: undefined,
      requestedBaseUrl: "https://brand-new.example/v1",
      postedApiKey: "typed-key-placeholder",
      providers,
    });
    expect(d).toEqual({
      ok: true,
      baseUrl: "https://brand-new.example/v1",
      key: "typed-key-placeholder",
      keySource: "posted",
    });
  });

  it("404s an unknown providerId instead of silently probing unkeyed", () => {
    const d = resolveEgressTarget({ providerId: "nope", requestedBaseUrl: "https://api.b.ai", postedApiKey: "", providers });
    expect(d.ok).toBe(false);
    if (d.ok) throw new Error("unreachable");
    expect(d.status).toBe(404);
    expect(d.error).toBe("provider_not_found");
  });

  it("rejects an unusable endpoint with a 400", () => {
    for (const bad of ["javascript:alert(1)", "api.b.ai", "https://user:pass@api.b.ai"]) {
      const d = resolveEgressTarget({ providerId: undefined, requestedBaseUrl: bad, postedApiKey: "k", providers });
      expect(d.ok, bad).toBe(false);
      if (!d.ok) expect(d.status).toBe(400);
    }
    const missing = resolveEgressTarget({ providerId: undefined, requestedBaseUrl: "", postedApiKey: "k", providers });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe("base_url_required");
  });

  it("refuses when the stored provider has no usable endpoint of its own", () => {
    const d = resolveEgressTarget({
      providerId: "1",
      requestedBaseUrl: "",
      postedApiKey: "",
      providers: [{ id: "1", baseUrl: "", apiKey: STORED_KEY }],
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toBe("provider_endpoint_unusable");
  });
});

describe("redactUpstreamText — no provider error body may carry key material", () => {
  it("drops a masked sk- key echoed by the provider", () => {
    const body = JSON.stringify({
      error: { message: "Incorrect API key provided: sk-test-key-placeholder-0123456789. Find it in your dashboard." },
    });
    const out = redactUpstreamText(body);
    expect(out).not.toContain("sk-test-key-placeholder");
    expect(out).not.toContain("0123456789");
    expect(out).toContain("Incorrect API key provided");
  });

  it("drops a bare Bearer credential and a raw secret of any length", () => {
    expect(redactUpstreamText("401 unauthorized: Bearer test-key-placeholder")).not.toContain("test-key-placeholder");
    expect(redactUpstreamText("token test-key-placeholder rejected")).not.toContain("test-key-placeholder");
    expect(redactUpstreamText("key=abcdef0123456789abcdef0123456789")).not.toContain("abcdef0123456789");
  });

  it("keeps an ordinary short error readable", () => {
    expect(redactUpstreamText("AI glm 503: model overloaded, retry later")).toContain("model overloaded");
  });

  it("is total: null, undefined, objects and control characters never throw", () => {
    for (const v of [null, undefined, 0, {}, { error: { message: "boom" } }, ["a"]]) {
      expect(() => redactUpstreamText(v)).not.toThrow();
      expect(typeof redactUpstreamText(v)).toBe("string");
    }
    expect(redactUpstreamText("a\u0000b\u0007c")).toContain("abc");
  });

  it("truncates to the requested budget", () => {
    expect(redactUpstreamText("x".repeat(500), 40).length).toBeLessThanOrEqual(40);
    expect(redactUpstreamText("x".repeat(500)).length).toBeLessThanOrEqual(240);
  });
});
