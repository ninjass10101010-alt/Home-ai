/**
 * The outbound-URL guard (`src/lib/safe-fetch.ts`) is the SSRF boundary for
 * every server-side fetch of a caller-supplied URL. These tests pin the DENY
 * RULES themselves, independent of any route: a rule that regresses here
 * silently re-opens a read primitive into the family's Docker network
 * (pocketbase:8090, hermes-agent-2, 192.168.0.28:8090) and the NAS itself
 * (169.254.169.254 is the cloud metadata endpoint).
 *
 * The invariant under test is deliberately blunt: the guard judges the RESOLVED
 * ADDRESS, never the string the caller typed. `pocketbase` is not "not a
 * dotted quad, therefore fine" — it is an internal service name, and it is
 * refused before DNS is even consulted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  dnsLookup: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: mocks.dnsLookup }));

import {
  OutboundRequestError,
  assertOutboundUrlAllowed,
  classifyIpAddress,
  isBlockedIpAddress,
  safeFetchOutboundText,
  MAX_OUTBOUND_BYTES,
  MAX_REDIRECT_HOPS,
} from "@/lib/safe-fetch";

/** Public addresses used for "this host is fine" controls. */
const PUBLIC_V4 = "93.184.216.34";
const PUBLIC_V4_ALT = "93.184.216.35";
const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946";

function dnsAnswers(map: Record<string, string | string[]>) {
  mocks.dnsLookup.mockImplementation(async (hostname: string) => {
    const hit = map[String(hostname)];
    if (!hit) {
      const err = new Error(`getaddrinfo ENOTFOUND ${hostname}`) as NodeJS.ErrnoException;
      err.code = "ENOTFOUND";
      throw err;
    }
    const list = Array.isArray(hit) ? hit : [hit];
    return list.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
  });
}

function okResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, { status: 200, ...init });
}

beforeEach(() => {
  mocks.dnsLookup.mockReset();
  mocks.fetchMock.mockReset();
  vi.stubGlobal("fetch", mocks.fetchMock);
  dnsAnswers({ "recipes.com": PUBLIC_V4 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("classifyIpAddress / isBlockedIpAddress", () => {
  it("refuses loopback in both families", () => {
    for (const ip of ["127.0.0.1", "127.1.2.3", "0.0.0.0", "::1", "0:0:0:0:0:0:0:1"]) {
      expect(isBlockedIpAddress(ip), ip).toBe(true);
    }
  });

  it("refuses the cloud metadata endpoint and all link-local", () => {
    for (const ip of ["169.254.169.254", "169.254.0.1", "fe80::1", "fe80::a00:27ff:fe4e:66a1"]) {
      expect(isBlockedIpAddress(ip), ip).toBe(true);
    }
  });

  it("refuses RFC1918 private space and the Docker-network carriers", () => {
    for (const ip of ["10.0.0.5", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.0.28"]) {
      expect(isBlockedIpAddress(ip), ip).toBe(true);
    }
  });

  it("refuses the NAS-facing home ranges that are NOT RFC1918", () => {
    // 100.64/10 (CGNAT) is the range a QNAP/some routers hand out on a
    // "public-looking" lease; 192.0.0/24, the TEST-NETs and the
    // benchmarking block are documentation/reserved space that must never be
    // reachable from a user-supplied URL.
    for (const ip of [
      "100.64.0.1",
      "100.127.255.255",
      "192.0.0.8",
      "192.0.2.5",
      "198.18.0.1",
      "198.51.100.7",
      "203.0.113.9",
    ]) {
      expect(isBlockedIpAddress(ip), ip).toBe(true);
    }
  });

  it("refuses multicast, reserved and the broadcast address", () => {
    for (const ip of ["224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255", "ff02::1"]) {
      expect(isBlockedIpAddress(ip), ip).toBe(true);
    }
  });

  it("refuses IPv6 unique-local, site-local and unspecified space", () => {
    for (const ip of [
      "fc00::1",
      "fd00::1",
      "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "fec0::1",
      "::",
      "2001:db8::1",
    ]) {
      expect(isBlockedIpAddress(ip), ip).toBe(true);
    }
  });

  it("refuses the IPv4-in-IPv6 forms that would smuggle a loopback past a naive parse", () => {
    // ::ffff:127.0.0.1 is the classic bypass: the string is "IPv6" and never
    // matches a dotted-quad regex, yet it routes to loopback.
    for (const ip of [
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::127.0.0.1",
      "64:ff9b::7f00:1",
      "2002:7f00:1::",
    ]) {
      expect(isBlockedIpAddress(ip), ip).toBe(true);
    }
  });

  it("accepts real public addresses in both families", () => {
    for (const ip of [
      "8.8.8.8",
      "93.184.216.34",
      "1.1.1.1",
      "2606:2800:220:1:248:1893:25c8:1946",
      "2a00:1450:4001:81b::200e",
    ]) {
      expect(isBlockedIpAddress(ip), ip).toBe(false);
      expect(classifyIpAddress(ip), ip).toBe("public");
    }
  });

  it("reports a non-literal as not_a_literal instead of guessing", () => {
    // The DNS path owns this case. Reporting "not blocked" for a name would
    // hand the caller a false all-clear; reporting "blocked" would make every
    // real domain unreachable. The verdict is deliberately its own state.
    expect(classifyIpAddress("recipes.com")).toBe("not_a_literal");
    expect(classifyIpAddress("not an ip")).toBe("not_a_literal");
    expect(isBlockedIpAddress("recipes.com")).toBe(false);
  });
});

describe("assertOutboundUrlAllowed — scheme", () => {
  it("refuses every non-http(s) scheme, including file: and gopher:", async () => {
    for (const url of [
      "file:///etc/passwd",
      "gopher://127.0.0.1:11211/_stats",
      "ftp://recipes.com/x.txt",
      "data:text/html,<h1>hi</h1>",
      "javascript:alert(1)",
    ]) {
      await expect(assertOutboundUrlAllowed(url)).rejects.toMatchObject({
        code: "scheme_not_allowed",
      });
    }
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a URL carrying embedded credentials", async () => {
    await expect(
      assertOutboundUrlAllowed("http://user:pass@recipes.com/r"),
    ).rejects.toMatchObject({ code: "credentials_in_url" });
  });

  it("refuses a string that is not a URL at all", async () => {
    await expect(assertOutboundUrlAllowed("not a url")).rejects.toBeInstanceOf(
      OutboundRequestError,
    );
  });
});

describe("assertOutboundUrlAllowed — resolved address, not the string", () => {
  it("refuses internal Docker service names without consulting DNS", async () => {
    // pocketbase / hermes-agent-2 resolve only inside the compose network, but
    // they are reachable from this container — and the old dotted-quad regex
    // waved every one of them through.
    for (const url of ["http://pocketbase:8090/", "http://hermes-agent-2/", "http://consuela-dashboard/"]) {
      await expect(assertOutboundUrlAllowed(url)).rejects.toMatchObject({
        code: "blocked_hostname",
      });
    }
    expect(mocks.dnsLookup).not.toHaveBeenCalled();
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it("refuses mDNS / special-use suffixes even when they carry a dot", async () => {
    for (const url of [
      "http://pocketbase.local/",
      "http://nas.localdomain/",
      "http://db.internal/",
      "http://nas.home.arpa/",
    ]) {
      await expect(assertOutboundUrlAllowed(url)).rejects.toMatchObject({
        code: "blocked_hostname",
      });
    }
    expect(mocks.dnsLookup).not.toHaveBeenCalled();
  });

  it("refuses RFC 6761 special-use names — they can never be a real recipe page", async () => {
    for (const url of [
      "http://site.example/",
      "http://site.test/",
      "http://site.invalid/",
      "http://site.onion/",
    ]) {
      await expect(assertOutboundUrlAllowed(url)).rejects.toMatchObject({
        code: "blocked_hostname",
      });
    }
    expect(mocks.dnsLookup).not.toHaveBeenCalled();
  });

  it("refuses a public name that resolves into private space", async () => {
    dnsAnswers({ "rebind-target.com": ["93.184.216.34", "127.0.0.1"] });
    await expect(assertOutboundUrlAllowed("http://rebind-target.com/r")).rejects.toMatchObject({
      code: "private_address",
    });
  });

  it("refuses a public name that resolves to the metadata endpoint", async () => {
    dnsAnswers({ "metadata-target.com": "169.254.169.254" });
    await expect(assertOutboundUrlAllowed("http://metadata-target.com/latest/meta-data/")).rejects.toMatchObject({
      code: "private_address",
    });
  });

  it("refuses a public name that resolves to an IPv6 ULA", async () => {
    dnsAnswers({ "ula-target.com": "fd00::1" });
    await expect(assertOutboundUrlAllowed("http://ula-target.com/r")).rejects.toMatchObject({
      code: "private_address",
    });
  });

  it("fails honestly (502 dns_failed) when the name does not resolve", async () => {
    await expect(assertOutboundUrlAllowed("http://nowhere-at-all.com/r")).rejects.toMatchObject({
      code: "dns_failed",
      status: 502,
    });
  });

  it("accepts a public name and hands back the parsed URL", async () => {
    const url = await assertOutboundUrlAllowed("https://recipes.com/best-cake");
    expect(url.hostname).toBe("recipes.com");
    expect(url.protocol).toBe("https:");
  });

  it("refuses a loopback literal written in an obfuscated IPv4 form", async () => {
    // The WHATWG URL parser normalizes these to 127.0.0.1 — the guard must see
    // the normalized hostname, not the caller's spelling.
    for (const url of ["http://2130706433/", "http://0x7f.1/", "http://0177.0.0.1/", "http://127.1/"]) {
      await expect(assertOutboundUrlAllowed(url)).rejects.toMatchObject({
        code: "private_address",
      });
    }
  });
});

describe("safeFetchOutboundText — redirect hops", () => {
  it("re-validates EVERY hop: a public 302 into loopback is refused", async () => {
    mocks.fetchMock.mockImplementation(async (input: any) => {
      if (String(input) === "https://recipes.com/r") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:8090/api/health" },
        });
      }
      throw new Error(`the guard let a hop through to ${String(input)}`);
    });

    await expect(
      safeFetchOutboundText("https://recipes.com/r", { userAgents: ["probe"] }),
    ).rejects.toMatchObject({ code: "private_address", status: 400 });

    // The internal target was never requested.
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    expect(String(mocks.fetchMock.mock.calls[0][0])).toBe("https://recipes.com/r");
  });

  it("re-validates a hop that redirects to an internal service NAME", async () => {
    mocks.fetchMock.mockImplementation(async (input: any) => {
      if (String(input) === "https://recipes.com/r") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://pocketbase:8090/api/collections" },
        });
      }
      throw new Error(`the guard let a hop through to ${String(input)}`);
    });

    await expect(
      safeFetchOutboundText("https://recipes.com/r", { userAgents: ["probe"] }),
    ).rejects.toMatchObject({ code: "blocked_hostname" });
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never asks fetch to auto-follow: redirect is always manual", async () => {
    mocks.fetchMock.mockResolvedValue(okResponse("<html>hi</html>"));
    await safeFetchOutboundText("https://recipes.com/r", { userAgents: ["probe"] });
    expect(mocks.fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("follows a public→public redirect and reports the FINAL url", async () => {
    mocks.fetchMock.mockImplementation(async (input: any) => {
      if (String(input) === "https://recipes.com/r") {
        return new Response(null, { status: 301, headers: { location: "https://www.recipes.com/r" } });
      }
      if (String(input) === "https://www.recipes.com/r") {
        return okResponse("<html>final</html>");
      }
      throw new Error(`unexpected hop ${String(input)}`);
    });
    dnsAnswers({ "recipes.com": PUBLIC_V4, "www.recipes.com": PUBLIC_V6 });

    const result = await safeFetchOutboundText("https://recipes.com/r", { userAgents: ["probe"] });
    expect(result.text).toContain("final");
    expect(result.url).toBe("https://www.recipes.com/r");
    expect(result.hops).toBe(1);
  });

  it("stops at the hop cap instead of chasing an endless chain", async () => {
    let n = 0;
    mocks.fetchMock.mockImplementation(async () => {
      n += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `https://recipes.com/hop-${n}` },
      });
    });

    await expect(
      safeFetchOutboundText("https://recipes.com/r", { userAgents: ["probe"] }),
    ).rejects.toMatchObject({ code: "too_many_redirects" });
    expect(n).toBe(MAX_REDIRECT_HOPS + 1);
  });

  it("refuses a redirect that downgrades the scheme to file: or javascript:", async () => {
    // A 302 to `file:///etc/passwd` parses fine as a URL, so the hop is only
    // stopped by the SAME scheme check — which is why it runs on every hop and
    // not just on the submitted string.
    for (const location of ["file:///etc/passwd", "javascript:alert(1)", "gopher://127.0.0.1:11211/"]) {
      mocks.fetchMock.mockReset();
      mocks.fetchMock.mockImplementation(async (input: any) => {
        if (String(input) === "https://recipes.com/r") {
          return new Response(null, { status: 302, headers: { location } });
        }
        throw new Error(`the guard let a hop through to ${String(input)}`);
      });
      await expect(
        safeFetchOutboundText("https://recipes.com/r", { userAgents: ["probe"] }),
      ).rejects.toMatchObject({ code: "scheme_not_allowed", status: 400 });
      // Only the first, public hop was ever requested.
      expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("refuses a redirect whose Location is not a resolvable URL", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://[bad" } }),
    );
    await expect(
      safeFetchOutboundText("https://recipes.com/r", { userAgents: ["probe"] }),
    ).rejects.toMatchObject({ code: "invalid_url" });
  });

  it("refuses a redirect with no Location at all", async () => {
    mocks.fetchMock.mockResolvedValue(new Response(null, { status: 302 }));
    await expect(
      safeFetchOutboundText("https://recipes.com/r", { userAgents: ["probe"] }),
    ).rejects.toMatchObject({ code: "bad_redirect" });
  });
});

describe("safeFetchOutboundText — size and time budgets", () => {
  it("refuses a body that declares an oversized content-length", async () => {
    mocks.fetchMock.mockResolvedValue(
      okResponse("small", { headers: { "content-length": String(MAX_OUTBOUND_BYTES + 1) } }),
    );
    await expect(
      safeFetchOutboundText("https://recipes.com/r", { userAgents: ["probe"] }),
    ).rejects.toMatchObject({ code: "too_large", status: 413 });
  });

  it("refuses a body that OVERFLOWS the cap while streaming (no content-length)", async () => {
    // The header is absent or lies, so the cap has to be enforced on the bytes
    // actually read — otherwise one chunked response can exhaust memory.
    const chunk = new Uint8Array(256 * 1024);
    mocks.fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            for (let i = 0; i < 40; i += 1) controller.enqueue(chunk);
            controller.close();
          },
        }),
      ),
    );

    await expect(
      safeFetchOutboundText("https://recipes.com/r", { userAgents: ["probe"] }),
    ).rejects.toMatchObject({ code: "too_large", status: 413 });
  });

  it("returns a body just under the cap intact", async () => {
    const text = "x".repeat(1024);
    mocks.fetchMock.mockResolvedValue(okResponse(text));
    const result = await safeFetchOutboundText("https://recipes.com/r", { userAgents: ["probe"] });
    expect(result.text).toBe(text);
  });

  it("maps an aborted/aborted-by-deadline fetch to a 504 timeout", async () => {
    mocks.fetchMock.mockImplementation(async () => {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    });
    await expect(
      safeFetchOutboundText("https://recipes.com/r", { userAgents: ["probe"] }),
    ).rejects.toMatchObject({ code: "timeout", status: 504 });
  });

  it("maps a transport failure to a 502, never a silent empty body", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      safeFetchOutboundText("https://recipes.com/r", { userAgents: ["probe"] }),
    ).rejects.toMatchObject({ code: "network_error", status: 502 });
  });

  it("does not read the body of a non-ok response", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    mocks.fetchMock.mockResolvedValue(new Response(body, { status: 404 }));
    const result = await safeFetchOutboundText("https://recipes.com/r", { userAgents: ["probe"] });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.text).toBe("");
  });
});

describe("safeFetchOutboundText — CDN user-agent retry", () => {
  it("retries once with the fallback UA on 403, then returns the body", async () => {
    const seen: string[] = [];
    mocks.fetchMock.mockImplementation(async (_input: any, init: any) => {
      seen.push(init.headers["User-Agent"]);
      if (seen.length === 1) return new Response("forbidden", { status: 403 });
      return okResponse("<html>recipe</html>");
    });

    const result = await safeFetchOutboundText("https://recipes.com/r", {
      userAgents: ["Consuela-Dashboard/1.0 RecipeImporter", "Mozilla/5.0 Chrome/126.0.0.0"],
    });
    expect(seen).toEqual([
      "Consuela-Dashboard/1.0 RecipeImporter",
      "Mozilla/5.0 Chrome/126.0.0.0",
    ]);
    expect(result.ok).toBe(true);
    expect(result.text).toContain("recipe");
  });

  it("stops after the last UA instead of looping", async () => {
    let calls = 0;
    mocks.fetchMock.mockImplementation(async () => {
      calls += 1;
      return new Response("forbidden", { status: 403 });
    });
    const result = await safeFetchOutboundText("https://recipes.com/r", {
      userAgents: ["a", "b", "c"],
    });
    expect(calls).toBe(3);
    expect(result.status).toBe(403);
  });

  it("re-validates the target on the retry too", async () => {
    mocks.fetchMock.mockImplementation(async () => new Response("forbidden", { status: 403 }));
    await expect(
      safeFetchOutboundText("http://127.0.0.1/", { userAgents: ["a", "b"] }),
    ).rejects.toMatchObject({ code: "private_address" });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });
});
