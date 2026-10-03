/**
 * POST /api/recipes/ingest — the SSRF boundary, exercised through the ROUTE.
 *
 * The bug these tests pin: the route validated the URL *string* with a
 * dotted-quad regex, then let `fetch` follow redirects on its own. So
 * `pocketbase:8090`, `169.254.169.254`, an IPv6 ULA, and a public page that
 * 302s to loopback all reached an authenticated-but-unprivileged caller — and
 * the fetched bytes came back inside `recipe.instructions`.
 *
 * Every test here carries a valid PARENT session, because the route now also
 * carries a role gate: a child session must be refused before any of the
 * network work happens at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  dnsLookup: vi.fn(),
  fetchMock: vi.fn(),
  withAdmin: vi.fn(),
  liveRole: "parent",
  liveMemberMissing: false,
  pbDown: false,
}));

vi.mock("node:dns/promises", () => ({ lookup: mocks.dnsLookup }));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => {
    if (mocks.pbDown) return Promise.reject(new Error("PB unreachable"));
    return mocks.withAdmin(fn);
  },
}));

import { POST } from "@/app/api/recipes/ingest/route";
import { signSession, SESSION_COOKIE } from "@/lib/session";

const PUBLIC_V4 = "93.184.216.34";
/** The NAS's own address inside the compose network — the P0 example. */
const NAS_IP = "192.168.0.28";

function dnsAnswers(map: Record<string, string | string[]>) {
  mocks.dnsLookup.mockImplementation(async (hostname: string) => {
    const hit = map[String(hostname)];
    if (!hit) {
      const err = new Error(`getaddrinfo ENOTFOUND ${hostname}`) as NodeJS.ErrnoException;
      err.code = "ENOTFOUND";
      throw err;
    }
    const list = Array.isArray(hit) ? hit : [hit];
    return list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  });
}

/** A page carrying a valid schema.org Recipe, so extraction succeeds. */
const RECIPE_HTML = `<!doctype html><html><head><script type="application/ld+json">
{"@context":"https://schema.org","@type":"Recipe","name":"Lemon Cake",
"recipeIngredient":["200g flour","2 lemons"],"recipeInstructions":"Mix. Bake. Serve.",
"recipeYield":"8 slices","totalTime":"PT45M"}
</script></head><body><h1>Lemon Cake</h1></body></html>`;

async function parentCookie(): Promise<string> {
  mocks.liveRole = "parent";
  const token = await signSession({ memberId: "m1", name: "Rebecca", role: "parent" });
  return `${SESSION_COOKIE}=${token}`;
}

async function cookie(role: string): Promise<string> {
  mocks.liveRole = role;
  const token = await signSession({ memberId: "m1", name: "Rebecca", role });
  return `${SESSION_COOKIE}=${token}`;
}

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/recipes/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function postUrl(url: string, cookieHeader: string) {
  return POST(req({ type: "url", url, sourceLabel: "Web" }, { cookie: cookieHeader }));
}

/** Every URL fetch must be refused BEFORE any socket work, so assert both. */
async function expectRefused(url: string) {
  const res = await postUrl(url, await parentCookie());
  const body = await res.json().catch(() => ({}));
  expect(res.status, `${url} -> ${JSON.stringify(body)}`).toBe(400);
  expect(typeof body?.error).toBe("string");
  // The response must not carry any fetched bytes back to the caller.
  expect(JSON.stringify(body)).not.toMatch(/root:x:/);
  expect(mocks.fetchMock).not.toHaveBeenCalled();
  return body;
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  vi.stubEnv("ADMIN_SECRET", "");
  vi.stubEnv("CONSUELA_ENCRYPTION_KEY", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=");
  vi.stubGlobal("fetch", mocks.fetchMock);
  mocks.fetchMock.mockReset();
  mocks.dnsLookup.mockReset();
  mocks.withAdmin.mockReset();
  mocks.liveRole = "parent";
  mocks.liveMemberMissing = false;
  mocks.pbDown = false;
  mocks.withAdmin.mockImplementation((fn: any) =>
    fn({
      collection: () => ({
        getOne: async (id: string) => {
          if (mocks.liveMemberMissing) {
            const err: any = new Error("not found");
            err.status = 404;
            throw err;
          }
          return { id, name: "Rebecca", role: mocks.liveRole, pin: "1234" };
        },
      }),
    }),
  );
  dnsAnswers({ "recipes.com": PUBLIC_V4, "www.recipes.com": PUBLIC_V4, "evil-recipe.com": PUBLIC_V4 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/recipes/ingest — role gate", () => {
  it("401s an unauthenticated caller before any network work", async () => {
    const res = await POST(req({ type: "url", url: "https://recipes.com/r" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
    expect(mocks.dnsLookup).not.toHaveBeenCalled();
  });

  it("403s a live CHILD session", async () => {
    const res = await postUrl("https://recipes.com/r", await cookie("child"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "adult_only" });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it("403s a live PET session", async () => {
    const res = await postUrl("https://recipes.com/r", await cookie("pet"));
    expect(res.status).toBe(403);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it("trusts the LIVE PocketBase role, not the role in the cookie", async () => {
    // Signed cookie says `parent`; the live row has been demoted. The gate must
    // follow the live row.
    const stale = await parentCookie();
    mocks.liveRole = "child";
    const res = await postUrl("https://recipes.com/r", stale);
    expect(res.status).toBe(403);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the live identity read is unavailable", async () => {
    mocks.pbDown = true;
    const res = await postUrl("https://recipes.com/r", await parentCookie());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "identity_unavailable" });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it("401s when the live member row is gone (session points at nobody)", async () => {
    mocks.liveMemberMissing = true;
    const res = await postUrl("https://recipes.com/r", await parentCookie());
    expect(res.status).toBe(401);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it("gates the paste-text path too — it spends the same LLM key", async () => {
    const res = await POST(
      req({ type: "text", fileText: "1 cup flour\n2 eggs\nBake it well" }, { cookie: await cookie("child") }),
    );
    expect(res.status).toBe(403);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/recipes/ingest — SSRF deny rules (URL type)", () => {
  it("refuses http://127.0.0.1/", async () => {
    await expectRefused("http://127.0.0.1/");
  });

  it("refuses http://127.0.0.1:8090/ with a port", async () => {
    await expectRefused("http://127.0.0.1:8090/");
  });

  it("refuses http://[::1]/", async () => {
    await expectRefused("http://[::1]/");
  });

  it("refuses the cloud metadata endpoint 169.254.169.254", async () => {
    await expectRefused("http://169.254.169.254/latest/meta-data/iam/security-credentials/");
  });

  it("refuses http://pocketbase:8090/ (internal service name)", async () => {
    const body = await expectRefused("http://pocketbase:8090/api/collections");
    expect(JSON.stringify(body)).not.toContain("collections");
  });

  it("refuses http://hermes-agent-2/ (internal service name)", async () => {
    await expectRefused("http://hermes-agent-2/health");
  });

  it("refuses an IPv6 unique-local address (fc00::/7)", async () => {
    await expectRefused("http://[fd00::1]/");
    await expectRefused("http://[fc00::1]:8090/");
  });

  it("refuses an IPv6 link-local address (fe80::/10)", async () => {
    await expectRefused("http://[fe80::1]/");
  });

  it("refuses IPv4-mapped loopback ::ffff:127.0.0.1", async () => {
    await expectRefused("http://[::ffff:127.0.0.1]/");
  });

  it("refuses file:///etc/passwd and other non-http schemes", async () => {
    for (const url of ["file:///etc/passwd", "gopher://127.0.0.1:11211/", "ftp://recipes.com/x"]) {
      await expectRefused(url);
    }
  });

  it("refuses the NAS's own LAN address", async () => {
    await expectRefused(`http://${NAS_IP}:8090/api/health`);
  });

  it("refuses a public name that resolves to a private address", async () => {
    dnsAnswers({ "sneaky-target.com": "127.0.0.1" });
    const res = await postUrl("http://sneaky-target.com/r", await parentCookie());
    expect(res.status).toBe(400);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a public name whose DNS answer set includes one private address", async () => {
    dnsAnswers({ "split-horizon.com": [PUBLIC_V4, "169.254.169.254"] });
    const res = await postUrl("http://split-horizon.com/r", await parentCookie());
    expect(res.status).toBe(400);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an oversized declared body with 413", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response("tiny", {
        status: 200,
        headers: { "content-length": String(5 * 1024 * 1024 + 1) },
      }),
    );
    const res = await postUrl("https://recipes.com/r", await parentCookie());
    expect(res.status).toBe(413);
    expect(JSON.stringify(await res.json())).not.toContain("tiny");
  });

  it("refuses a body that overflows the cap while streaming", async () => {
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
    const res = await postUrl("https://recipes.com/r", await parentCookie());
    expect(res.status).toBe(413);
  });

  it("504s a fetch that outlives the deadline", async () => {
    mocks.fetchMock.mockImplementation(async () => {
      const err: any = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    });
    const res = await postUrl("https://recipes.com/r", await parentCookie());
    expect(res.status).toBe(504);
  });
});

describe("POST /api/recipes/ingest — the redirect hole", () => {
  it("refuses a PUBLIC page that 302s to 127.0.0.1", async () => {
    mocks.fetchMock.mockImplementation(async (input: any) => {
      if (String(input) === "https://evil-recipe.com/r") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:8090/api/health" },
        });
      }
      throw new Error(`the guard let a hop through to ${String(input)}`);
    });

    const res = await postUrl("https://evil-recipe.com/r", await parentCookie());
    const body = await res.json().catch(() => ({}));

    expect(res.status).toBe(400);
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    expect(String(mocks.fetchMock.mock.calls[0][0])).toBe("https://evil-recipe.com/r");
    // The internal response body must never come back through the app.
    expect(JSON.stringify(body)).not.toContain("127.0.0.1:8090/api/health");
    expect(JSON.stringify(body)).not.toContain("root:");
  });

  it("refuses a redirect chain that walks public -> public -> loopback", async () => {
    mocks.fetchMock.mockImplementation(async (input: any) => {
      if (String(input) === "https://evil-recipe.com/a") {
        return new Response(null, { status: 302, headers: { location: "https://evil-recipe.com/b" } });
      }
      if (String(input) === "https://evil-recipe.com/b") {
        return new Response(null, { status: 302, headers: { location: "http://192.168.0.28:8090/" } });
      }
      throw new Error(`the guard let a hop through to ${String(input)}`);
    });

    const res = await postUrl("https://evil-recipe.com/a", await parentCookie());
    expect(res.status).toBe(400);
    expect(mocks.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a redirect to the metadata endpoint", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }),
    );
    const res = await postUrl("https://evil-recipe.com/r", await parentCookie());
    expect(res.status).toBe(400);
  });

  it("refuses a redirect to an internal service NAME", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://pocketbase:8090/api/collections" } }),
    );
    const res = await postUrl("https://evil-recipe.com/r", await parentCookie());
    expect(res.status).toBe(400);
  });

  it("refuses a redirect that downgrades the scheme to file:", async () => {
    mocks.fetchMock.mockImplementation(async (input: any) => {
      if (String(input) === "https://evil-recipe.com/r") {
        return new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } });
      }
      throw new Error(`the guard let a hop through to ${String(input)}`);
    });

    const res = await postUrl("https://evil-recipe.com/r", await parentCookie());
    expect(res.status).toBe(400);
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks fetch for redirect:manual on every hop", async () => {
    mocks.fetchMock.mockResolvedValue(new Response(RECIPE_HTML, { status: 200 }));
    await postUrl("https://recipes.com/r", await parentCookie());
    expect(mocks.fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });
});

describe("POST /api/recipes/ingest — the feature still works", () => {
  it("imports a public recipe page and stores the VALIDATED final url", async () => {
    mocks.fetchMock.mockResolvedValue(new Response(RECIPE_HTML, { status: 200 }));

    const res = await postUrl("https://recipes.com/best-cake", await parentCookie());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.structured).toBe(true);
    expect(body.recipe.title).toBe("Lemon Cake");
    expect(body.recipe.sourceUrl).toBe("https://recipes.com/best-cake");
  });

  it("follows a public->public redirect and records where the recipe actually came from", async () => {
    mocks.fetchMock.mockImplementation(async (input: any) => {
      if (String(input) === "https://recipes.com/r") {
        return new Response(null, {
          status: 301,
          headers: { location: "https://www.recipes.com/r" },
        });
      }
      return new Response(RECIPE_HTML, { status: 200 });
    });

    const res = await postUrl("https://recipes.com/r", await parentCookie());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.recipe.sourceUrl).toBe("https://www.recipes.com/r");
  });

  it("keeps the 403 CDN copy when a public page blocks the importer", async () => {
    mocks.fetchMock.mockResolvedValue(new Response("forbidden", { status: 403 }));

    const res = await postUrl("https://recipes.com/r", await parentCookie());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Paste text tab/i);
  });

  it("keeps the 404 and 429 copy", async () => {
    mocks.fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));
    expect((await postUrl("https://recipes.com/r", await parentCookie())).status).toBe(404);

    mocks.fetchMock.mockResolvedValue(new Response("slow down", { status: 429 }));
    expect((await postUrl("https://recipes.com/r", await parentCookie())).status).toBe(429);
  });

  it("never falls back to a recipe body when the fetch itself failed", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await postUrl("https://recipes.com/r", await parentCookie());
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.recipe).toBeUndefined();
    expect(body.instructions).toBeUndefined();
  });

  it("still answers the unimplemented pdf type without touching the network", async () => {
    const res = await POST(req({ type: "pdf" }, { cookie: await parentCookie() }));
    expect(res.status).toBe(501);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });
});
