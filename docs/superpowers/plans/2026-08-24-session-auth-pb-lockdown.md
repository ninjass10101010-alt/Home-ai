# Session Auth + PocketBase Lockdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close review findings #1/#3/#4 — server-side session auth on all API routes, PocketBase collections locked to admin-only with all browser access rerouted through an authenticated gateway, and hardcoded family PINs removed from the client bundle.

**Architecture:** HMAC-signed httpOnly session cookie issued by `/api/auth/login` after server-side PIN verification. Next.js middleware rejects unauthenticated `/api/**` calls except routes with their own stronger gates (cron bearer, admin pin/secret, alarm PIN). A generic `/api/db/...` gateway (session-required, collection-allowlisted) replaces direct browser→PocketBase traffic; `src/db/index.ts` gains a client branch that calls the gateway so existing hooks/pages don't change. PB rules flip from public (`""`) to admin-only (`null`) and the seeder enforces the locked state instead of self-healing it open. Login no longer trusts the client: the browser never sees PINs at all.

**Tech Stack:** Next.js App Router middleware (Web Crypto for edge-safe HMAC verify), node:crypto in server libs, PocketBase admin SDK via existing `withAdmin`, vitest.

## Global Constraints

- No new npm dependencies — use `node:crypto` (server) and `crypto.subtle` (middleware).
- `SESSION_SECRET` and existing env vars are required in docker-compose (`${VAR:?}` style) — fail fast.
- Kid mode behavior must not change: children can log in; role comes from the server session, never the request body.
- Intent-confirmation PIN prompts (alarm arm/disarm, emergency, suggestions act) stay PIN-typed; they verify server-side via `verifyPinFromPB`/`verifyPinAgainstAnyMember` as today.
- All existing tests must stay green (suite currently 428 passing).
- Every task ends with `npx vitest run`, `npm run typecheck`, and a commit.

---

### Task 1: SESSION_SECRET infrastructure

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces: env var `SESSION_SECRET` available to all server code and middleware.

- [ ] **Step 1: Add to `.env.example`** directly under the `ADMIN_SECRET` block:

```bash
# Signs dashboard session cookies (HMAC). Generate: openssl rand -base64 32
SESSION_SECRET=generate-a-long-random-string
```

- [ ] **Step 2: Add to `docker-compose.yml`** home-dashboard environment list, right after the `ADMIN_SECRET` line:

```yaml
      # Signs httpOnly session cookies — required or login will fail closed.
      - SESSION_SECRET=${SESSION_SECRET:?set SESSION_SECRET in .env}
```

- [ ] **Step 3: Validate compose YAML**

Run: `npx js-yaml docker-compose.yml > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add .env.example docker-compose.yml
git commit -m "chore(security): require SESSION_SECRET env"
```

---

### Task 2: Session sign/verify library

**Files:**
- Create: `src/lib/session.ts`
- Test: `tests/unit/session.test.ts`

**Interfaces:**
- Produces:
  - `signSession(payload: SessionPayload): Promise<string>` → `"v1.<b64url-json>.<b64url-hmac>"`
  - `verifySession(token: string | undefined | null): Promise<SessionPayload | null>`
  - `interface SessionPayload { memberId: string; name: string; role: string; iat: number; exp: number }`
  - `SESSION_COOKIE = "consuela_session"`
  - `SESSION_TTL_SECONDS = 60 * 60 * 24 * 7`
- Middleware (edge runtime) uses `verifySession` — it must run on Web Crypto only (no node:crypto imports).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/session.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { signSession, verifySession } from "../../src/lib/session";

beforeEach(() => vi.stubEnv("SESSION_SECRET", "test-secret-0123456789"));
afterEach(() => vi.unstubAllEnvs());

describe("session tokens", () => {
  it("round-trips a signed payload", async () => {
    const token = await signSession({ memberId: "m1", name: "Rebecca", role: "parent" });
    const out = await verifySession(token);
    expect(out).toMatchObject({ memberId: "m1", name: "Rebecca", role: "parent" });
    expect(out!.exp).toBeGreaterThan(out!.iat!);
  });

  it("rejects tampered payloads", async () => {
    const token = await signSession({ memberId: "m1", name: "Rebecca", role: "child" });
    const [, body] = token.split(".");
    const forged = ["v1", btoa(JSON.stringify({ memberId: "m1", name: "X", role: "parent", iat: 1, exp: 9e15 })).replace(/=+$/, ""), body].join(".");
    expect(await verifySession(forged)).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const token = await signSession({ memberId: "m1", name: "R", role: "parent" }, -10);
    expect(await verifySession(token)).toBeNull();
  });

  it("fails closed without SESSION_SECRET", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    const token = await signSession({ memberId: "m1", name: "R", role: "parent" });
    expect(await verifySession(token)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/session.test.ts`
Expected: FAIL — cannot find module `../../src/lib/session`

- [ ] **Step 3: Implement**

```ts
// src/lib/session.ts
export const SESSION_COOKIE = "consuela_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionPayload {
  memberId: string;
  name: string;
  role: string;
  iat?: number;
  exp: number;
}

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const c of b) s += String.fromCharCode(c);
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function secret(): string {
  return process.env.SESSION_SECRET || "";
}

export async function signSession(
  payload: Omit<SessionPayload, "iat" | "exp">,
  ttlSeconds: number = SESSION_TTL_SECONDS
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: SessionPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const body = b64url(enc.encode(JSON.stringify(full)));
  const sig = await crypto.subtle.sign("HMAC", await key(secret()), enc.encode(`v1.${body}`));
  return `v1.${body}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token || !secret()) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await key(secret()),
      fromB64url(parts[2]),
      enc.encode(`v1.${parts[1]}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1]))) as SessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
```

Note: `process.env.SESSION_SECRET` is inlined at build time for edge bundles by Next.js — do not destructure it at module top level (that's why `secret()` reads it lazily).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/session.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/session.ts tests/unit/session.test.ts
git commit -m "feat(auth): HMAC session token lib (edge-safe Web Crypto)"
```

---

### Task 3: Auth routes — login / logout / whoami

**Files:**
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/app/api/auth/whoami/route.ts`
- Test: `tests/unit/auth-routes.test.ts`

**Interfaces:**
- Consumes: `signSession`, `verifySession`, `verifyPinFromPB(name, pin)` from `@/lib/server-auth`, `sanitizeMember`.
- Produces: `POST /api/auth/login {memberName, pin}` → sets `consuela_session` cookie (`httpOnly; sameSite=lax; path=/; max-age=SESSION_TTL_SECONDS`), returns sanitized member. 401 on bad PIN. `POST /api/auth/logout` clears cookie. `GET /api/auth/whoami` returns `{ member }` or 401.

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/auth-routes.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ verifyPinFromPB: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({
  verifyPinFromPB: mocks.verifyPinFromPB,
  sanitizeMember: (m: any) => {
    const { pin, ...rest } = m;
    return rest;
  },
}));

import { POST as loginPOST } from "@/app/api/auth/login/route";
import { GET as whoamiGET } from "@/app/api/auth/whoami/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";

function req(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, init as any);
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  mocks.verifyPinFromPB.mockReset();
});

describe("POST /api/auth/login", () => {
  it("sets an httpOnly session cookie on valid PIN", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent", pin: "9999" });
    const res = await loginPOST(req("http://x/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberName: "Rebecca", pin: "1234" }),
    }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain("consuela_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect((await res.json()).member.pin).toBeUndefined();
  });

  it("returns 401 on invalid PIN and 400 on missing fields", async () => {
    mocks.verifyPinFromPB.mockResolvedValue(null);
    expect((await loginPOST(req("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberName: "R", pin: "0000" }) }))).status).toBe(401);
    expect((await loginPOST(req("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }))).status).toBe(400);
  });
});

describe("GET /api/auth/whoami", () => {
  it("returns the member from a valid session cookie", async () => {
    const { signSession } = await import("@/lib/session");
    const token = await signSession({ memberId: "m1", name: "Rebecca", role: "parent" });
    const res = await whoamiGET(req("http://x/api/auth/whoami", { headers: { cookie: `consuela_session=${token}` } }));
    expect(res.status).toBe(200);
    expect((await res.json()).member.name).toBe("Rebecca");
  });

  it("returns 401 without a cookie", async () => {
    expect((await whoamiGET(req("http://x/api/auth/whoami"))).status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie", async () => {
    const res = await logoutPOST(req("http://x/api/auth/logout", { method: "POST" }));
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
```

- [ ] **Step 2: Verify RED** — Run: `npx vitest run tests/unit/auth-routes.test.ts` → Expected: FAIL (routes missing)

- [ ] **Step 3: Implement the three routes**

```ts
// src/app/api/auth/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifyPinFromPB, sanitizeMember } from "@/lib/server-auth";
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { memberName, pin } = await request.json();
    if (!memberName || !pin) {
      return NextResponse.json({ error: "memberName and pin are required" }, { status: 400 });
    }
    const member = await verifyPinFromPB(String(memberName), String(pin));
    if (!member) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }
    const token = await signSession({ memberId: member.id, name: member.name, role: member.role });
    const res = NextResponse.json({ success: true, member: sanitizeMember(member) });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch {
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
```

```ts
// src/app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
```

```ts
// src/app/api/auth/whoami/route.ts
import { NextRequest, NextResponse } from "next/server";
import { findMemberByName, sanitizeMember } from "@/lib/server-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const member = await findMemberByName(session.name);
  if (!member) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ member: sanitizeMember(member) });
}
```

- [ ] **Step 4: Verify GREEN** — Run: `npx vitest run tests/unit/auth-routes.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth tests/unit/auth-routes.test.ts
git commit -m "feat(auth): server-side login/logout/whoami with httpOnly session cookie"
```

---

### Task 4: Middleware gate on /api/**

**Files:**
- Modify: `src/middleware.ts`
- Test: `tests/unit/middleware-gate.test.ts`

**Interfaces:**
- Consumes: `verifySession`, `SESSION_COOKIE`.
- Behavior: requests to `/api/**` REQUIRE a valid session EXCEPT prefixes: `/api/auth/login`, `/api/cron/`, `/api/admin/`, `/api/ha/alarm`, `/api/emergency`, `/api/db/` NO — db gateway IS sessioned, do NOT exempt it. Pages are untouched (open shell; data is gated at the API layer).

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/middleware-gate.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { middleware } from "../../src/middleware";
import { signSession, SESSION_COOKIE } from "../../src/lib/session";

function req(path: string, cookie?: string): Request {
  return new Request(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });
}

function nextUrl(path: string) { return new URL(path, "http://localhost"); }

beforeEach(() => vi.stubEnv("SESSION_SECRET", "test-secret-0123456789"));
afterEach(() => vi.unstubAllEnvs());

describe("middleware /api gate", () => {
  it("401s anonymous /api/tasks", async () => {
    const res = await middleware(req("/api/tasks"), undefined as any) as Response;
    expect(res?.status ?? 0).toBe(401); // adjust to actual return shape in Step 3 note
  });

  it("allows valid session through", async () => {
    const token = await signSession({ memberId: "m1", name: "R", role: "parent" });
    const res = await middleware(req("/api/tasks", `${SESSION_COOKIE}=${token}`), undefined as any);
    expect(res).toBeUndefined(); // undefined = continue
  });

  it.each(["/api/cron/consuela/briefing", "/api/admin/version", "/api/ha/alarm", "/api/emergency", "/api/auth/login"])(
    "exempts %s (own gate)", async (path) => {
      const res = await middleware(req(path), undefined as any);
      expect(res).toBeUndefined();
    }
  );

  it("does not touch non-API routes", async () => {
    expect(await middleware(req("/settings"), undefined as any)).toBeUndefined();
    expect(await middleware(req("/_design-system"), undefined as any)).toBeUndefined();
  });
});
```

> Note for implementer: current `src/middleware.ts` exports a default rewrite handler for `/_design-system`. KEEP that behavior. If the file's structure makes returning `undefined` impossible (Next requires `NextResponse.next()`), have the test assert `res.headers.get("x-middleware-next") === "1"` instead of `toBeUndefined()` — pick one convention and use it everywhere in this test file.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/unit/middleware-gate.test.ts`
Expected: FAIL — `/api/tasks` anonymous request is not rejected today.

- [ ] **Step 3: Implement**

```ts
// src/middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// Prefixes that carry their own auth gate (CRON_SECRET bearer, admin
// pin/secret, alarm PIN, emergency PIN, login itself).
const API_EXEMPT = [
  "/api/auth/login",
  "/api/cron/",
  "/api/admin/",
  "/api/ha/alarm",
  "/api/emergency",
];

export async function middleware(request: NextRequest) {
  const { pathname } = nextUrl(request);

  // Keep the existing design-system preview rewrite working.
  if (pathname.startsWith("/_design-system")) {
    return NextResponse.rewrite(new URL("/design-system", request.url));
  }

  if (pathname.startsWith("/api/") && !API_EXEMPT.some((p) => pathname.startsWith(p))) {
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.next();
}

function nextUrl(request: NextRequest): URL {
  return new URL(request.url);
}

export const config = {
  matcher: ["/api/:path*", "/_design-system"],
};
```

Preserve whatever the existing file had for `_design-system` semantics (read it first; if it used `RewriteResponse`, adapt lines but keep the gate logic above intact).

- [ ] **Step 4: Verify GREEN** — full suite: `npx vitest run` (existing route tests call route handlers directly, not through middleware, so they are unaffected)

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts tests/unit/middleware-gate.test.ts
git commit -m "feat(auth): middleware requires session for /api/** (own-gated prefixes exempt)"
```

---

### Task 5: Admin gate accepts adult sessions; UI stops sending raw PIN

**Files:**
- Modify: `src/lib/admin-auth.ts`
- Modify: `src/app/settings/page.tsx` (local VersionCard `adminHeaders`)
- Modify: `src/components/settings/VersionCard.tsx`
- Test: extend `tests/unit/admin-auth.test.ts`

**Interfaces:**
- `authorizeAdminRequest(request)` gains a third accepted credential: a valid session cookie whose `role !== "child"`.

- [ ] **Step 1: Add failing tests** to `tests/unit/admin-auth.test.ts`:

```ts
it("accepts a valid adult session cookie", async () => {
  const { signSession, SESSION_COOKIE } = await import("../../src/lib/session");
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  const token = await signSession({ memberId: "m1", name: "R", role: "parent" });
  const result = await authorizeAdminRequest(req({ cookie: `${SESSION_COOKIE}=${token}` }));
  expect(result.ok).toBe(true);
});

it("rejects a child session cookie with 403", async () => {
  const { signSession, SESSION_COOKIE } = await import("../../src/lib/session");
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  const token = await signSession({ memberId: "m2", name: "Kid", role: "child" });
  const result = await authorizeAdminRequest(req({ cookie: `${SESSION_COOKIE}=${token}` }));
  expect(result.ok).toBe(false);
  expect(result.status).toBe(403);
});
```

- [ ] **Step 2: Verify RED**, then implement in `admin-auth.ts` — inside `authorizeAdminRequest`, BEFORE the pin check:

```ts
  const { verifySession, SESSION_COOKIE } = await import("./session");
  const session = await verifySession(
    request instanceof Request ? request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] : undefined
  );
  if (session) {
    if (session.role === "child") return { ok: false, status: 403, error: "adult_only" };
    return { ok: true };
  }
```

(In routes receiving `NextRequest`, prefer `request.cookies.get(SESSION_COOKIE)?.value`; the regex fallback keeps the helper framework-agnostic.)

- [ ] **Step 3: Simplify both VersionCards** — replace `adminHeaders` with `{}`:

```ts
// settings page local VersionCard + components/settings/VersionCard.tsx
fetch("/api/admin/version")            // no headers needed — session rides along
...
const r = await fetch("/api/admin/update", { method: "POST" });
```

Remove the `adminHeaders` helpers and the `currentUser?.pin` usage entirely from both files (keep `useAuth` only if still needed elsewhere in that scope).

- [ ] **Step 4: Verify GREEN + typecheck**, then commit:

```bash
git add src/lib/admin-auth.ts src/app/settings/page.tsx src/components/settings/VersionCard.tsx tests/unit/admin-auth.test.ts
git commit -m "feat(auth): admin routes accept adult sessions; UI drops PIN header"
```

---

### Task 6: DB gateway route (sessioned, allowlisted)

**Files:**
- Create: `src/app/api/db/[collection]/route.ts` (LIST, CREATE)
- Create: `src/app/api/db/[collection]/[id]/route.ts` (GET one, UPDATE, DELETE)
- Create: `src/lib/db-gateway.ts` (allowlist + field sanitizer)
- Test: `tests/unit/db-gateway.test.ts`

**Interfaces:**
- Consumes: `withAdmin`.
- Produces:
  - `DB_GATEWAY_COLLECTIONS: ReadonlySet<string>` — initial set: `grocery_list_items, pantry_items, meal_plan_entries, meal_week_archive, recipes, events, schedules, tasks, week_data, week_archive, rewards, penalties, family_goals, hall_of_fame, chat_messages, morning_briefing, proactive_suggestions, consuela_state` — audit-driven; Task 8 extends it based on grep results.
  - `sanitizeRow(collection, row)` strips internal fields (`pin` never appears — members is NOT gateway-exposed; identity flows via `/api/auth/*` only).
  - Routes: `GET /[collection]?filter=<pb-filter>&sort=&limit=` (hard cap 500), `POST /[collection]` body=row, `PATCH|DELETE /[collection]/[id]`.

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/db-gateway.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/session";

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn() }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: (fn: any) => mocks.withAdmin(fn) }));

import { GET as listGET, POST as createPOST } from "@/app/api/db/[collection]/route";
import { PATCH as patchOne, DELETE as deleteOne } from "@/app/api/db/[collection]/[id]/route";

function sessionReq(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, {
    ...init,
    headers: { ...(init?.headers || {}) }, // cookie injected per-test below
  } as any) as NextRequest;
}

async function withSession(r: NextRequest): Promise<NextRequest> {
  const token = await signSession({ memberId: "m1", name: "R", role: "parent" });
  r.headers.set("cookie", `${SESSION_COOKIE}=${token}`);
  return r;
}

const pbOk = {
  collection: () => ({
    getFullList: vi.fn(async () => [{ id: "r1", name: "Milk", pin: "SHOULD_NOT_EXIST" }]),
    create: vi.fn(async (row: any) => ({ id: "new1", ...row })),
    getOne: vi.fn(async () => ({ id: "r1", done: false })),
    update: vi.fn(async (_id: string, row: any) => ({ id: "r1", ...row })),
    delete: vi.fn(async () => ({})),
  }),
};

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  mocks.withAdmin.mockReset();
  mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pbOk));
});

describe("db gateway", () => {
  it("lists rows for a sessioned caller on an allowed collection", async () => {
    const res = await listGET(await withSession(sessionReq("http://x/api/db/grocery_list_items")), { params: Promise.resolve({ collection: "grocery_list_items" }) } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items[0].id).toBe("r1");
  });

  it("rejects non-allowlisted collections with 404", async () => {
    const res = await listGET(await withSession(sessionReq("http://x/api/db/members")), { params: Promise.resolve({ collection: "members" }) } as any);
    expect(res.status).toBe(404);
  });

  it("creates a row (sanitized)", async () => {
    const res = await createPOST(
      await withSession(sessionReq("http://x/api/db/grocery_list_items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Eggs", pinField: "hack" }) })),
      { params: Promise.resolve({ collection: "grocery_list_items" }) } as any
    );
    expect(res.status).toBe(200);
    expect(pbOk.collection("x").create).toHaveBeenCalledWith(expect.not.objectContaining({ pinField: "hack" }), expect.anything());
  });

  it("patches and deletes by id", async () => {
    const p = { params: Promise.resolve({ collection: "tasks", id: "r1" }) } as any;
    expect((await patchOne(await withSession(sessionReq("http://x/api/db/tasks/r1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ done: true }) })), p)).status).toBe(200);
    expect((await deleteOne(await withSession(sessionReq("http://x/api/db/tasks/r1", { method: "DELETE" })), p)).status).toBe(200);
  });
});
```

> Implementer note: if your Next version's route-context typing differs (params as value vs promise), adapt the two `params` casts to compile — behavior asserted stays identical.

- [ ] **Step 2: Verify RED** (module missing), then implement:

```ts
// src/lib/db-gateway.ts
export const DB_GATEWAY_COLLECTIONS: ReadonlySet<string> = new Set([
  "grocery_list_items", "pantry_items", "meal_plan_entries", "recipes",
  "events", "schedules", "tasks", "week_data", "week_archive",
  "rewards", "penalties", "family_goals", "hall_of_fame",
  "chat_messages", "morning_briefing", "proactive_suggestions", "consuela_state",
]);

export function isGatewayCollection(collection: string): boolean {
  return DB_GATEWAY_COLLECTIONS.has(collection);
}

/** Strip anything that looks like internal/credential fields before writing
 * client-supplied rows, and cap list sizes. */
export function sanitizeClientRow(row: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...row };
  delete clean.id;
  delete clean.created;
  delete clean.updated;
  delete clean.collectionId;
  delete clean.collectionName;
  for (const k of Object.keys(clean)) {
    if (/pin|secret|password|token/i.test(k)) delete clean[k];
  }
  return clean;
}

export const MAX_LIST_LIMIT = 500;
```

Route files follow the standard pattern — LIST example:

```ts
// src/app/api/db/[collection]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { isGatewayCollection, sanitizeClientRow, MAX_LIST_LIMIT } from "@/lib/db-gateway";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, ctx: any) {
  const { collection } = await ctx.params;
  if (!isGatewayCollection(collection)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || MAX_LIST_LIMIT, MAX_LIST_LIMIT);
  const items = await withAdmin(async (pb) =>
    pb.collection(collection).getFullList({
      requestKey: null,
      sort: url.searchParams.get("sort") || "-created",
      filter: url.searchParams.get("filter") || undefined,
    })
  );
  return NextResponse.json({ items: (items as any[]).slice(0, limit) });
}

export async function POST(request: NextRequest, ctx: any) {
  const { collection } = await ctx.params;
  if (!isGatewayCollection(collection)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const body = sanitizeClientRow(await request.json());
  const row = await withAdmin(async (pb) => pb.collection(collection).create(body, { requestKey: null }));
  return NextResponse.json(row);
}
```

`[id]/route.ts`: GET→getOne, PATCH→update(id, sanitizeClientRow(body)), DELETE→delete — each behind the same allowlist check (copy the guard verbatim into each handler).

- [ ] **Step 3: Verify GREEN**, commit:

```bash
git add src/app/api/db src/lib/db-gateway.ts tests/unit/db-gateway.test.ts
git commit -m "feat(db): sessioned PB gateway with collection allowlist"
```

---

### Task 7: `db/index.ts` dual-mode — client goes through the gateway

**Files:**
- Modify: `src/db/index.ts`
- Create: `src/db/gateway-client.ts` (browser fetch wrapper)
- Test: `tests/unit/db-client-mode.test.ts`

**Interfaces:**
- Produces: `isServer(): boolean`; `gatewayList(collection, opts)`, `gatewayCreate(collection,row)`, `gatewayUpdate(collection,id,row)`, `gatewayDelete(collection,id)` — thin fetch wrappers used ONLY when `typeof window !== "undefined"`. Server branch keeps calling existing `pb-db` functions unchanged.

- [ ] **Step 1: Failing test** — jsdom env (`// @vitest-environment jsdom`), stub `globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ items: [], id: "g1", success: true }) }))`, define `window` implicitly via jsdom, then:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/gateway-client", () => ({
  gatewayCreate: vi.fn(async () => ({ id: "g1" })),
  gatewayList: vi.fn(async () => []),
}));

describe("db/index client mode", () => {
  it("routes grocery writes through the gateway fetch path, not pb-db", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ id: "g1" }) })));
    const db = (await import("@/db/index")).default ?? (await import("@/db/index"));
    await (db as any).addGroceryItem({ name: "Eggs", category: "dairy" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/db/grocery_list_items",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("routes reads through gatewayList", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })));
    const db = await import("@/db/index");
    await (db as any).selectGrocery();
    expect(fetch).toHaveBeenCalledWith("/api/db/grocery_list_items");
  });
});
```

(Adjust exported accessor name to how `index.ts` actually exposes it — `db.addGroceryItem` vs `db.upsertGroceryItem` — by reading the file's export map first.)

- [ ] **Step 2: Verify RED**, then implement `src/db/gateway-client.ts`:

```ts
export async function gatewayList(collection: string, query = ""): Promise<any[]> {
  const res = await fetch(`/api/db/${collection}${query}`);
  if (!res.ok) throw new Error(`gateway_list_failed:${collection}:${res.status}`);
  return (await res.json()).items;
}
export async function gatewayCreate(collection: string, row: unknown) {
  const res = await fetch(`/api/db/${collection}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(row) });
  if (!res.ok) throw new Error(`gateway_create_failed:${collection}:${res.status}`);
  return res.json();
}
export async function gatewayUpdate(collection: string, id: string, row: unknown) {
  const res = await fetch(`/api/db/${collection}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(row) });
  if (!res.ok) throw new Error(`gateway_update_failed:${collection}:${res.status}`);
  return res.json();
}
export async function gatewayDelete(collection: string, id: string) {
  const res = await fetch(`/api/db/${collection}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`gateway_delete_failed:${collection}:${res.status}`);
}
```

In `src/db/index.ts`: add `function isServer() { return typeof window === "undefined"; }`. For EVERY method currently reaching `pb-db` from the browser (audit via grep of the export map — grocery, pantry, meals, recipes, events, schedules, tasks/week, rewards, penalties, goals, hall-of-fame, chat messages read, briefing read/write, suggestions read/update, consuela state get/set), branch:

```ts
if (!isServer()) return gatewayCreate("grocery_list_items", row);   // example
return pbDb.upsertGroceryItem(row);                                  // server path unchanged
```

Method-by-method mapping (grep `from "./pb-db"` inside `index.ts` to enumerate the full export list, then apply this table; any export whose collection is missing from `DB_GATEWAY_COLLECTIONS` gets ADDED in the same commit — `members` excluded by design):

| `db/index.ts` exports (grouped) | Collection |
|---|---|
| selectGrocery / upsertGroceryItem / updateGroceryItem / deleteGroceryItem | `grocery_list_items` |
| selectPantry / upsertPantryItem / updatePantryItem / deletePantryItem | `pantry_items` |
| selectMeals / insertMeal / updateMeal / deleteMeal (+archive) | `meal_plan_entries`, `meal_week_archive` |
| selectRecipes / upsertRecipe / deleteRecipe | `recipes` |
| selectEvents / upsertEvent / deleteEvent | `events` |
| selectSchedules / upsertScheduleItem / deleteScheduleItem | `schedules` |
| selectTasks / upsertTask + week fns (selectWeekData/upsertWeekData/week archive) | `tasks`, `week_data`, `week_archive` |
| rewards / penalties / family_goals / hall_of_fame CRUD | same-named collections |
| selectChatMessages / insertChatMessage | `chat_messages` |
| selectMorningBriefing / saveMorningBriefing / ack | `morning_briefing` |
| selectPendingSuggestions / updateSuggestion | `proactive_suggestions` |
| getState / setState | `consuela_state` |

- [ ] **Step 3: GREEN + full suite + typecheck. Commit:**

```bash
git add src/db/index.ts src/db/gateway-client.ts tests/unit/db-client-mode.test.ts src/lib/db-gateway.ts
git commit -m "feat(db): browser traffic routed through sessioned gateway"
```

---

### Task 8: Lock PocketBase rules; seed enforces lockdown

**Files:**
- Modify: `src/lib/pb-seed.ts` (PUBLIC_RULES → LOCKED_RULES; `rulesMatch` enforces lock)
- Test: extend `tests/unit/pb-schema-importance.test.ts` (or new `pb-rules-lockdown.test.ts`)

- [ ] **Step 1: Failing test** asserting the seed payload for every app collection carries `listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null`, and that a live-collection patch is issued when existing rules differ from locked (mock `withAdmin` like `pb-schema-importance.test.ts` does).

- [ ] **Step 2: Verify RED.** Implement:

```ts
// pb-seed.ts — replace PUBLIC_RULES
const LOCKED_RULES = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
// every COLLECTIONS entry: rules: LOCKED_RULES
// rulesMatch(live): true only when ALL five rules are null
// self-heal branch: update rule fields TO null when they differ ("(locked)" log marker)
```

- [ ] **Step 3:** Run against the dev PB instance (`npm run pb:seed` with `.env.integration` creds) and verify via PB admin UI that rules show admin-only. Then manual smoke: logged-out browser gets 401s from `/api/db/*`; logged-in flow works.

- [ ] **Step 4:** Full suite + commit:

```bash
git add src/lib/pb-seed.ts tests/unit/
git commit -m "feat(security): lock all PB collections to admin-only; seed enforces"
```

---

### Task 9: useAuth server login; remove PINs from the client bundle

**Files:**
- Modify: `src/hooks/useAuth.tsx`
- Modify: `src/lib/member-fallback.ts` (strip `pin` fields)
- Modify: `src/lib/member-pins.ts` (delete fallback-map construction; keep types)
- Modify: `src/app/api/emergency/route.ts` (verify against PB server-side: replace `db.selectMembers()` cache check with `verifyPinAgainstAnyMember(pin)` — header `x-emergency-pin` or body `pin` already exist)
- Test: `tests/unit/emergency-pin-server.test.ts` (new cases) + update `tests/unit/auth.test.ts`

- [ ] **Step 1: RED tests**: (a) emergency accepts a PB-valid pin while the old client-cache path would reject (mock `verifyPinAgainstAnyMember` resolved member vs empty selectMembers); (b) `useAuth.login` posts to `/api/auth/login` and stores NO `pin` in localStorage `consuela-auth-user` (jsdom, mock fetch → 200 with member).

- [ ] **Step 2:** Implement: `login()` becomes

```ts
const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberName, pin }) });
if (!res.ok) return { success: false, error: "Incorrect PIN" };
const { member } = await res.json();
// persist identity WITHOUT pin; keep in-memory pin off the context type
```

Delete the client-side `db.verifyMemberPin` call chain. Remove `pin` from `AuthUser` type and every `currentUser?.pin` reader (grep: settings adminHeaders already gone via Task 5; `useSuggestions` pin-cache falls back to its existing modal when absent — verify by running its tests).

- [ ] **Step 3:** Emergency route swap (exact diff):

```ts
// BEFORE: const members = await db.selectMembers(); ... namesMatch loop ...
// AFTER:
const { verifyPinAgainstAnyMember } = await import("@/lib/server-auth"); // top-level import preferred
const member = await verifyPinAgainstAnyMember(String(pin));
if (!member) return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
```

Keep the `EMERGENCY_PIN_BYPASS` test escape exactly as-is.

- [ ] **Step 4:** Grep-audit ZERO client-bundle PIN leakage: `grep -rn "\"0202\"\|\"0828\"" src/` returns nothing outside `pb-seed`/scripts; `grep -rn "pin" src/lib/member-fallback.ts` returns nothing.

- [ ] **Step 5:** Full suite + typecheck + commit:

```bash
git add src/hooks/useAuth.tsx src/lib/member-fallback.ts src/lib/member-pins.ts src/app/api/emergency/route.ts tests/
git commit -m "feat(auth): server-side login; PINs leave the client bundle"
```

---

### Task 10: Final integration audit + Playwright smoke

**Files:**
- Modify: `AGENTS.md` (snapshot + changelog)

- [ ] **Step 1:** Static audits (all must be clean):
  - `grep -rn "NEXT_PUBLIC_PB_URL" src/ --include="*.tsx" | grep -v api/` → empty (no client component builds PB URLs)
  - `grep -rn "getPB()" src/components src/hooks src/app --include="*.tsx"` → only server `api/` hits
  - `grep -rn "Bearer \${process.env" src/ | grep -v cron-auth | grep -v admin-auth` → empty

- [ ] **Step 2:** Manual Playwright pass (`npm run dev` + `.env.integration`): login as parent → Home widgets populate via gateway (Network tab shows `/api/db/*`, zero direct `:8090` calls) → House tab arm/disarm still prompts typed PIN → kid login: House tab hidden, chat has no house tools → logged-out curl `POST /api/db/tasks` → 401.

- [ ] **Step 3:** Full verification: `npx vitest run && npm run typecheck && npx eslint src` — record results in AGENTS.md snapshot line ("auth phase complete: sessions + locked PB"), update §5 security notes, commit:

```bash
git add AGENTS.md
git commit -m "docs: auth phase complete — sessions, locked PB, PIN-free client"
```

---

## Rollback Strategy

Each task is independently revertable. The dangerous step is Task 8 (locking rules) — it must land AFTER Tasks 6–7 are verified against the live dev instance, and rollback is re-running the previous seed (public rules) which the git history preserves. Middleware (Task 4) rollback = revert single file; clients keep working because gateway routes are additive.

## Explicitly Out of Scope (follow-ups)

- Rate limiting / lockout on login + PIN endpoints (review Minor #10)
- HTTPS/Tailscale Funnel termination notes for `secure` cookie flag
- Removing `EMERGENCY_PIN_BYPASS`
- Migrating `x-consuela-pin` suggestion routes onto sessions (they remain functional as-is)
