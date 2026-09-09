# Age-Based PIN-Free Tasks (Under-10 Kids) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Children under 10 (Aurora, Caspian) sign in with one avatar tap and complete assigned chores PIN-free; every kid completion (any age) waits for parent approval before points move; claims and rewards keep their PINs.

**Architecture:** `members` gains a real `age` number field (seed self-heal + one-time data-fix script). A fail-closed server route (`POST /api/auth/quick-login`) re-verifies `role === "child" && age < 10` against PocketBase on every request — the client never decides eligibility. Task rules split into two pure predicates in `task-utils.ts`; the Tasks page, KidHome, and the server-authoritative claim route all consume them so kid actions create `pendingApproval` rows instead of moving points.

**Tech Stack:** Next.js 16 (app router), React 19, TypeScript, PocketBase (pocketbase JS SDK v0.27), Vitest + jsdom (createRoot + act pattern, no testing-library).

**Spec:** `docs/superpowers/specs/2026-09-09-age-based-pin-free-tasks-design.md`

## Global Constraints

- PIN-free age ceiling: `age < 10` (strictly less; Jasmine at 10 keeps her PIN). Constant lives ONLY in `src/lib/task-utils.ts` as `PIN_FREE_MAX_AGE` (imported by the quick-login route — never re-declared).
- Eligibility is **server-verified and fails closed**: missing/zero/non-numeric age, wrong role, or PB unreachable → PIN path. The client branch is cosmetic (server re-checks on quick-login and on every claimed write).
- `isPendingApproval()` remains the only pending gate; pending points never enter `weekData.points`/`history` until approve; `completedInWeek` keeps the no-double-complete guarantee (all existing AGENTS.md contracts).
- No PINs, secrets, or `.env` contents in client bundles or committed files. Session cookie config must stay identical between `/api/auth/login` and `/api/auth/quick-login` (httpOnly, sameSite lax, SESSION_COOKIE_SECURE honored).
- Tests use the repo's jsdom pattern: `// @vitest-environment jsdom`, `createRoot` + `act`, query `document.body` for portaled Modal content.
- Commands run from `/Users/garciafam/Documents/Dashboard/Home-ai` unless noted. Full gates at the end: `npm run typecheck`, `npx eslint <touched files>`, `npx vitest run`, `npm run build`.

---

### Task 1: `age` in the data layer (schema → mappings → AuthUser → roster fix)

**Files:**
- Modify: `src/lib/pb-seed.ts` (members schema, ~line 27-44)
- Modify: `src/lib/server-auth.ts` (`ServerMember` interface, ~line 6-16)
- Modify: `src/db/pb-db.ts` (`selectMembers` + `selectMembersDetailed` maps, ~lines 94-125)
- Modify: `src/hooks/useAuth.tsx` (`AuthUser` interface ~line 35; login build ~line 243; PB-restore ~line 141; `handleMembersUpdated` ~line 173)
- Create: `/Users/garciafam/Documents/Dashboard/pb_migrations/1788500000_updated_members_age.js` (outer repo)
- Create: `scripts/consuela/set-member-ages.mjs`
- Test: `tests/unit/member-age-data.test.ts` (new)
- Test (modify): `tests/unit/pb-seed-field-heal.test.ts` (add members.age case)

**Interfaces:**
- Consumes: `memberFallbacks` (has numeric `age`), `withAdmin` (pb-auth), existing seed self-heal (adds missing fields to live collections).
- Produces: `ServerMember.age?: number`; roster rows from `db.selectMembers()`/`selectMembersDetailed()` carry `age` (number | string | undefined → consumers normalize); `AuthUser.age?: number`; seed adds `members.age` number field.

- [ ] **Step 1: Write the failing seed-schema test**

Append to `tests/unit/pb-seed-field-heal.test.ts`:

```ts
import { COLLECTIONS } from "@/lib/pb-seed";

describe("members.age (pin-free kids)", () => {
  it("members schema declares an optional number age", () => {
    const members = COLLECTIONS.find((c: any) => c.name === "members") as any;
    const age = members.schema.find((f: any) => f.name === "age");
    expect(age).toBeDefined();
    expect(age.type).toBe("number");
    expect(age.required).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/pb-seed-field-heal.test.ts`
Expected: FAIL — "age undefined".

- [ ] **Step 3: Add the field to the seed + migration**

In `src/lib/pb-seed.ts`, members schema (after `{ name: "role", type: "text" },`):

```ts
      { name: "role", type: "text" },
      // Age powers the under-10 PIN-free sign-in + task-completion rule
      // (PIN_FREE_MAX_AGE in task-utils). Optional: missing age fails closed
      // to the PIN path. Kept in lockstep with the outer pb_migrations file.
      { name: "age", type: "number", required: false },
```

In the outer repo, create `/Users/garciafam/Documents/Dashboard/pb_migrations/1788500000_updated_members_age.js` copying the exact shape of the existing `pb_migrations/1788223651_updated_members.js` (read it first), adding the `age` number field in `up()` and removing it in `down()`.

- [ ] **Step 4: Run the seed test to verify it passes**

Run: `npx vitest run tests/unit/pb-seed-field-heal.test.ts`
Expected: PASS.

- [ ] **Step 5: Pass `age` through server + client mappings**

`src/lib/server-auth.ts` — `ServerMember`:

```ts
export interface ServerMember {
  id: string;
  name: string;
  role: string;
  emoji: string;
  color: string;
  avatarSize?: string;
  glow?: boolean;
  age?: number;
  phone?: string;
  email?: string;
}
```

(`sanitizeMember` strips `pin` and spreads the rest — `age` flows automatically once PB rows/fallbacks carry it.)

`src/db/pb-db.ts` — in `selectMembers()` PB branch add `age: (r as any).age ?? undefined,` to the mapped object; in `selectMembersDetailed()` PB branch change `age: r.age || ""` to `age: r.age ?? "",` (already present — leave); in the FALLBACK branch of `selectMembers()` add `age: m.age,`.

- [ ] **Step 6: AuthUser gains age (three build sites)**

`src/hooks/useAuth.tsx` — `AuthUser` add `age?: number;`. Then at the login build (~line 243), PB-restore (~line 141), and `handleMembersUpdated` (~line 173), add:

```ts
        age: Number.isFinite(Number((member as any).age)) && (member as any).age != null && (member as any).age !== ""
          ? Number((member as any).age)
          : undefined,
```

(For `handleMembersUpdated`: `age: Number.isFinite(Number(member.age)) ? Number(member.age) : activeUser.age,`.) Also add `age: authUser.age,` to the `stored` object written to localStorage (no secret in it).

- [ ] **Step 7: Write + run the failing roster test**

Create `tests/unit/member-age-data.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitizeMember } from "@/lib/server-auth";

describe("member age data", () => {
  it("sanitizeMember keeps age and strips pin", () => {
    const out = sanitizeMember({ id: "x", name: "Caspian", role: "child", emoji: "🧒", color: "green", age: 5, pin: "1234" });
    expect(out.age).toBe(5);
    expect((out as any).pin).toBeUndefined();
  });
});
```

Run: `npx vitest run tests/unit/member-age-data.test.ts` → expect PASS (interface change is type-only; this pins the contract).

- [ ] **Step 8: The one-time roster data-fix script**

Create `scripts/consuela/set-member-ages.mjs` (loads `.env.local` like `scripts/pb-seed.mjs` does; idempotent; fills `age` ONLY on rows that lack it; source of truth = `memberFallbacks` by first name):

```js
// One-time: populate members.age on live PB rows that lack it (values from
// member-fallback.ts). Run AFTER `npm run pb:seed` adds the field. Safe to
// re-run: rows with a non-null age are skipped.
import PB from "pocketbase";
import { memberFallbacks } from "../src/lib/member-fallback.ts";

const envPath = new URL("../../.env.local", import.meta.url).pathname;
try { process.loadEnvFile(envPath); } catch {}
const url = process.env.NEXT_PUBLIC_PB_URL || "http://192.168.0.28:8090";
const email = process.env.PB_ADMIN_EMAIL, pass = process.env.PB_ADMIN_PASS;
if (!email || !pass) { console.error("PB_ADMIN_EMAIL/PB_ADMIN_PASS required"); process.exit(1); }

const pb = new PB(url);
await pb.collection("_superusers").authWithPassword({ email, password: pass });
const rows = await pb.collection("members").getFullList({ requestKey: null });
for (const r of rows) {
  if (r.age != null && r.age !== "") { console.log(`skip ${r.name} (age ${r.age})`); continue; }
  const first = String(r.name).split(" ")[0].toLowerCase();
  const fb = memberFallbacks.find((m) => m.name.split(" ")[0].toLowerCase() === first);
  if (!fb) { console.log(`no fallback age for ${r.name} — set it in Settings`); continue; }
  await pb.collection("members").update(r.id, { age: fb.age });
  console.log(`set ${r.name}.age = ${fb.age}`);
}
console.log("done");
```

Run: `node scripts/consuela/set-member-ages.mjs` against the LIVE PB (dev env points at it). Expected output: `set <name>.age = <n>` for every row that lacked one (after pb:seed ran), `skip` otherwise.

- [ ] **Step 9: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
cd /Users/garciafam/Documents/Dashboard/Home-ai && git add -A && git commit -m "feat(members): real age field — schema, mappings, AuthUser, roster data fix"
```

---

### Task 2: `PIN_FREE_MAX_AGE` + the two predicates (task-utils)

**Files:**
- Modify: `src/lib/task-utils.ts` (~lines 61-65)
- Create: `tests/unit/task-utils-pin-free.test.ts`

(Task 2 is additive only — `shouldUsePendingTap` and its direct tests stay untouched until Task 8 deletes them.)

**Interfaces:**
- Consumes: `isSnatchable(task)`, `Task`.
- Produces: `PIN_FREE_MAX_AGE = 10`; `completesWithoutPin(role, age, task): boolean`; `completesWithPendingApproval(role, task): boolean`. `shouldUsePendingTap` is **kept but @deprecated** (Tasks 5/7 migrate its call sites; Task 8 deletes it + its direct tests) — deleting it here would break the Tasks page/KidHome imports mid-plan and regress shipped kid taps in the interim commits.

- [ ] **Step 1: Write the failing predicate tests**

Create `tests/unit/task-utils-pin-free.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { completesWithoutPin, completesWithPendingApproval, PIN_FREE_MAX_AGE } from "@/lib/task-utils";

const assigned = { id: 1, title: "T", assignee: "Caspian", completed: false, points: 5, due: "2099-01-01" } as any;
const universal = { ...assigned, universal: true };
const overdue = { ...assigned, stealable: true, due: "2020-01-01" };
const done = { ...assigned, completed: true };

describe("PIN_FREE_MAX_AGE", () => {
  it("is 10 (strictly less-than; age 10 is NOT pin-free)", () => {
    expect(PIN_FREE_MAX_AGE).toBe(10);
  });
});

describe("completesWithoutPin (under-10 assigned taps)", () => {
  it("7yo child on an assigned task → true", () => {
    expect(completesWithoutPin("child", 7, assigned)).toBe(true);
  });
  it("age 9 true, age 10 false (boundary)", () => {
    expect(completesWithoutPin("child", 9, assigned)).toBe(true);
    expect(completesWithoutPin("child", 10, assigned)).toBe(false);
  });
  it("missing/non-numeric age fails closed", () => {
    expect(completesWithoutPin("child", undefined, assigned)).toBe(false);
    expect(completesWithoutPin("child", 0, assigned)).toBe(false);
    expect(completesWithoutPin("child", Number.NaN, assigned)).toBe(false);
  });
  it("never universal/snatchable/completed — and parents", () => {
    expect(completesWithoutPin("child", 5, universal)).toBe(false);
    expect(completesWithoutPin("child", 5, overdue)).toBe(false);
    expect(completesWithoutPin("child", 5, done)).toBe(false);
    expect(completesWithoutPin("parent", 5, assigned)).toBe(false);
    expect(completesWithoutPin(undefined, 5, assigned)).toBe(false);
  });
});

describe("completesWithPendingApproval (every child completion waits)", () => {
  it("child open task → true (universal handled at the claim site)", () => {
    expect(completesWithPendingApproval("child", assigned)).toBe(true);
  });
  it("adults and completed rows → false", () => {
    expect(completesWithPendingApproval("parent", assigned)).toBe(false);
    expect(completesWithPendingApproval("child", done)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run tests/unit/task-utils-pin-free.test.ts`
Expected: FAIL — "completesWithoutPin is not exported".

- [ ] **Step 3: Implement the two predicates (additive)**

In `src/lib/task-utils.ts`, keep the existing `shouldUsePendingTap` block (lines 61-65) untouched except add above it: `/** @deprecated migrate to completesWithoutPin (Tasks 5/7); deleted in Task 8. */`. Then insert after it:

```ts
// Age ceiling for PIN-free kid actions (sign-in eligibility re-checks the
// same bound server-side in /api/auth/quick-login — single source here).
export const PIN_FREE_MAX_AGE = 10;

// One tap, no PIN: under-10 kids complete ASSIGNED chores (never universal/
// snatchable — claims keep their PIN). Missing age fails closed to the PIN
// path. Task 7 routes every kid completion through pendingApproval.
export function completesWithoutPin(
  role: string | undefined,
  age: number | undefined,
  task: Task
): boolean {
  return (
    role === "child" &&
    typeof age === "number" &&
    Number.isFinite(age) &&
    age > 0 &&
    age < PIN_FREE_MAX_AGE &&
    !task.completed &&
    !task.universal &&
    !isSnatchable(task)
  );
}

// Every CHILD completion (any age) lands as done-but-unpaid: the PIN proves
// identity, the parent approves correctness. Adults keep instant earns.
export function completesWithPendingApproval(role: string | undefined, task: Task): boolean {
  return role === "child" && !task.completed;
}
```

- [ ] **Step 4: Run to verify GREEN**

Run: `npx vitest run tests/unit/task-utils-pin-free.test.ts tests/unit/tasks-pending-approval.test.ts` → PASS both (the old predicate's direct tests stay green because `shouldUsePendingTap` is untouched; Task 8 re-points them when it deletes the old seam). No src call-site changes in this task.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add src/lib/task-utils.ts tests/unit/task-utils-pin-free.test.ts tests/unit/tasks-pending-approval.test.ts && git commit -m "feat(tasks): PIN-free + pending-approval predicates keyed to age < 10"
```

---

### Task 3: Fail-closed quick-login route

**Files:**
- Create: `src/app/api/auth/quick-login/route.ts`
- Modify: `src/app/api/auth/login/route.ts` (reuse cookie config)
- Test: `tests/unit/auth-quick-login-route.test.ts` (new)

**Interfaces:**
- Consumes: `findMemberByName`, `sanitizeMember` (server-auth), `signSession`, `SESSION_COOKIE`, `SESSION_TTL_SECONDS` (session), existing `sessionCookieSecure()` exported from `login/route.ts`.
- Produces: `POST /api/auth/quick-login {memberName}` → 200 `{success, member}` + identical session cookie; `403 {error:"pin_required"}` (not a child, age missing/≥10/pet, PB read failure); `404` unknown member; `400` missing memberName. `/api/auth/` is already middleware-exempt — no gate change.

- [ ] **Step 1: Write the failing route tests**

Create `tests/unit/auth-quick-login-route.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const members = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("@/lib/server-auth", () => ({
  findMemberByName: async (name: string) =>
    members.rows.find((m: any) => m.name === name) || null,
  sanitizeMember: (m: any) => ({ ...m, pin: undefined }),
}));
vi.mock("@/lib/session", () => ({
  signSession: async () => "v1.token.sig",
  SESSION_COOKIE: "consuela_session",
  SESSION_TTL_SECONDS: 604800,
}));

import { POST } from "@/app/api/auth/quick-login/route";

function req(body: any) {
  return new NextRequest("http://localhost/api/auth/quick-login", {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  members.rows = [
    { id: "a", name: "Caspian", role: "child", age: 5, pin: "1010" },
    { id: "b", name: "Jasmine", role: "child", age: 10, pin: "0402" },
    { id: "c", name: "Bailey", role: "child", pin: "1005" },        // age missing
    { id: "d", name: "Rico", role: "pet", age: 5, pin: "0000" },
    { id: "e", name: "Rebecca", role: "parent", age: 38, pin: "0202" },
  ];
});

describe("POST /api/auth/quick-login", () => {
  it("signs in an under-10 child and sets the session cookie", async () => {
    const res = await POST(req({ memberName: "Caspian" }));
    expect(res.status).toBe(200);
    expect(res.cookies.get("consuela_session")?.value).toBe("v1.token.sig");
    const body = await res.json();
    expect(body.member.name).toBe("Caspian");
    expect(body.member.pin).toBeUndefined();
  });
  it("rejects a 10-year-old (strictly under 10)", async () => {
    expect((await POST(req({ memberName: "Jasmine" }))).status).toBe(403);
  });
  it("fails closed when age is missing", async () => {
    expect((await POST(req({ memberName: "Bailey" }))).status).toBe(403);
  });
  it("rejects pets and parents", async () => {
    expect((await POST(req({ memberName: "Rico" }))).status).toBe(403);
    expect((await POST(req({ memberName: "Rebecca" }))).status).toBe(403);
  });
  it("404 unknown member, 400 missing name", async () => {
    expect((await POST(req({ memberName: "Nobody" }))).status).toBe(404);
    expect((await POST(req({}))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run tests/unit/auth-quick-login-route.test.ts`
Expected: FAIL — module `@/app/api/auth/quick-login/route` not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/auth/quick-login/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { findMemberByName, sanitizeMember } from "@/lib/server-auth";
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";
import { PIN_FREE_MAX_AGE } from "@/lib/task-utils";
import { sessionCookieSecure } from "../login/route";

export const dynamic = "force-dynamic";

// PIN-free sign-in for under-10 children (spec 2026-09-09). Eligibility is
// decided HERE, server-side, against the PB member record — never from a
// client-supplied flag. Missing age, age >= PIN_FREE_MAX_AGE, non-child role,
// or a failed roster read all fail closed to the normal PIN path. The points
// blast radius is already capped: kid task completions land in pendingApproval
// (parent-awarded) and claims/rewards still require the kid's PIN.
function ageOf(member: any): number | null {
  const n = Number(member?.age);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function POST(request: NextRequest) {
  try {
    const { memberName } = await request.json();
    if (!memberName) {
      return NextResponse.json({ error: "memberName is required" }, { status: 400 });
    }
    if (!process.env.SESSION_SECRET) {
      return NextResponse.json({ error: "SESSION_SECRET not configured" }, { status: 500 });
    }
    const member = await findMemberByName(String(memberName));
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    const age = ageOf(member);
    if (member.role !== "child" || age === null || age >= PIN_FREE_MAX_AGE) {
      return NextResponse.json({ error: "pin_required" }, { status: 403 });
    }
    const token = await signSession({ memberId: member.id, name: member.name, role: member.role });
    const res = NextResponse.json({ success: true, member: sanitizeMember(member) });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: sessionCookieSecure(),
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch (err) {
    console.error("[auth/quick-login] failed:", err);
    // A PB read failure or bad body never signs anyone in — the client falls
    // back to the PIN modal. 403 (not 500) so the UI reason stays "PIN".
    return NextResponse.json({ error: "pin_required" }, { status: 403 });
  }
}
```

- [ ] **Step 4: Run tests to verify GREEN + the login route still passes**

Run: `npx vitest run tests/unit/auth-quick-login-route.test.ts tests/unit/session-cookie-secure.test.ts`
Expected: PASS on both (the login-route test confirms `sessionCookieSecure` stays exported — the import path `../login/route` proves cookie parity).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add src/app/api/auth/quick-login/route.ts tests/unit/auth-quick-login-route.test.ts && git commit -m "feat(auth): fail-closed quick-login route for under-10 child sessions"
```

---

### Task 4: `quickLogin` in useAuth + one-tap sign-in on Home

**Files:**
- Modify: `src/hooks/useAuth.tsx` (login success block ~219-287; add `quickLogin`; context value; `AuthContextValue` interface ~45-60)
- Modify: `src/components/auth/MemberPickerModal.tsx` (PickerMember + copy)
- Modify: `src/app/page.tsx` (both sign-in branches: ~line 412 family-strip, ~line 695 picker `onSelect`)
- Test: `tests/unit/use-auth-quick-login.test.ts` (new; mirror `tests/unit/use-auth-login.test.ts`'s harness)

**Interfaces:**
- Consumes: `POST /api/auth/quick-login` (Task 3), Task 1's `age` on members/AuthUser.
- Produces: `useAuth().quickLogin(memberName: string): Promise<{ success: boolean; error?: string }>`; `PickerMember.age?: number`; Home's shared `handleSignInPick(member)` branches under-10 → `quickLogin` (PIN modal fallback on any failure — stale rosters fail safe).

- [ ] **Step 1: Write the failing hook test**

Create `tests/unit/use-auth-quick-login.test.ts`, copying the mount/harness pattern of `tests/unit/use-auth-login.test.ts` (read it first) and asserting:

```ts
it("quickLogin signs in via /api/auth/quick-login and stores the auth user", async () => {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true, status: 200, json: async () => ({ success: true, member: { id: "7", name: "Caspian", role: "child", emoji: "🧒", color: "green", age: 5 } }),
  }));
  vi.stubGlobal("fetch", fetchMock as any);
  const { result } = renderAuthHook(); // harness mirroring use-auth-login.test.ts
  await act(async () => { const r = await result.current.quickLogin("Caspian"); expect(r.success).toBe(true); });
  expect(fetchMock.mock.calls.some(([u]: any) => u === "/api/auth/quick-login")).toBe(true);
  expect(localStorage.getItem("consuela-auth-user")).toContain('"age":5');
  vi.unstubAllGlobals();
});

it("quickLogin failure does not sign in", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "pin_required" }) })) as any);
  const { result } = renderAuthHook();
  await act(async () => { const r = await result.current.quickLogin("Jasmine"); expect(r.success).toBe(false); });
  expect(result.current.currentUser).toBeNull();
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run tests/unit/use-auth-quick-login.test.ts` → `quickLogin` is not a function.

- [ ] **Step 3: Implement `quickLogin` (reuse login's post-success flow)**

In `useAuth.tsx`: factor the login body after `member` is obtained into a local `const finishLogin = (member: any) => { …setCurrentUser, localStorage stored (now includes `age: authUser.age`), createAuthSession, flushPendingWrites, return {success:true} }`; login becomes `fetch → json → finishLogin(member)`. Add beside it:

```ts
  const quickLogin = useCallback(async (memberName: string): Promise<{ success: boolean; error?: string }> => {
    // Server decides eligibility (role/age against PB); any non-200 falls
    // back to the normal PIN path. We never learn a PIN — there isn't one.
    let res: Response;
    try {
      res = await fetch("/api/auth/quick-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberName }),
      });
    } catch {
      return { success: false, error: "Network error" };
    }
    if (!res.ok) return { success: false, error: "PIN required" };
    let member: any;
    try { ({ member } = await res.json()); } catch { return { success: false, error: "Sign-in failed" }; }
    if (!member?.name) return { success: false, error: "Sign-in failed" };
    return finishLogin(member);
  }, []);
```

Add `quickLogin` to `AuthContextValue` and the provider value object.

- [ ] **Step 4: Run hook tests to verify GREEN**

Run: `npx vitest run tests/unit/use-auth-quick-login.test.ts tests/unit/use-auth-login.test.ts` → PASS both.

- [ ] **Step 5: One-tap branch on Home + picker type/copy**

`MemberPickerModal.tsx`: `PickerMember` gains `age?: number;`. Modal description: `"Pick your face — little kids sign right in. Others enter their PIN."`

`src/app/page.tsx`: replace both `onSelect` bodies (the family-strip click at ~line 412 and the MemberPickerModal `onSelect` at ~line 695) with one helper (define near the other handlers; use the already-imported `useAuth` `quickLogin` and existing toast):

```ts
  // Under-10 kids: one tap signs in (server still re-verifies; a 403 means
  // the roster was stale and we fall back to the PIN modal — fail safe).
  const isPinFreeChild = (member: { role?: string; age?: number }) =>
    member.role === "child" &&
    typeof member.age === "number" &&
    member.age > 0 &&
    member.age < PIN_FREE_MAX_AGE; // imported from "@/lib/task-utils" — single source

  const handleSignInPick = async (member: any) => {
    setPickerOpen(false);
    if (isPinFreeChild(member)) {
      const r = await quickLogin(member.name);
      if (!r.success) {
        setPinningMember({ name: member.name, emoji: member.emoji || "😊", color: member.color || "green", avatarSize: normalizeAvatarSize(member.avatarSize), glow: member.glow || false });
        showToast("Tap your PIN to sign in.");
      }
      return;
    }
    setPinningMember({ name: member.name, emoji: member.emoji || "😊", color: member.color || "green", avatarSize: normalizeAvatarSize(member.avatarSize), glow: member.glow || false });
  };
```

Both call sites → `onSelect={handleSignInPick}` (the strip site may currently set `pinningMember` inline — route it through the helper; keep the member-tap-opens-ProfileSheet branch intact if the signed-in member was tapped).

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck` → clean. `npx eslint src/hooks/useAuth.tsx src/app/page.tsx src/components/auth/MemberPickerModal.tsx` → clean on touched files.

```bash
git add src/hooks/useAuth.tsx src/app/page.tsx src/components/auth/MemberPickerModal.tsx tests/unit/use-auth-quick-login.test.ts && git commit -m "feat(auth): one-tap sign-in for under-10 kids (quickLogin + Home branch)"
```

---

### Task 5: Tasks page — PIN-free taps + PIN→pending for 10+ kids

**Files:**
- Modify: `src/app/tasks/page.tsx` (`openPinEntry` ~689-735; `submitPin` tail ~1060+)
- Modify: `tests/unit/tasks-pending-flow.test.tsx` (fixtures gain ages)
- Test: `tests/unit/tasks-pin-free-flow.test.tsx` (new)

**Interfaces:**
- Consumes: `completesWithoutPin`, `completesWithPendingApproval` (Task 2), `currentUser.age` (Task 1), `tapCompletePending` (existing), `verifyPinRemote` (kid-store; `result.member` carries role).
- Produces: under-10 assigned tap → pending, no modal; child (any age) assigned PIN-complete → pending, not earn; adult flow untouched; claims untouched here (Task 6).

- [ ] **Step 1: Write the failing page tests**

Create `tests/unit/tasks-pin-free-flow.test.tsx` mirroring `tasks-pending-flow.test.tsx`'s harness, with `membersData` including `{ name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 5 }` and `{ name: "Jasmine", ..., role: "child", age: 10 }`:

```ts
it("Caspian (5) taps an assigned chore: pending, NO PIN modal", async () => {
  mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 };
  // render + open Tasks tab (harness as tasks-pending-flow)
  const row = Array.from(el.querySelectorAll("[role='button']")).find((b) => b.textContent?.includes("Feed the dog"))!;
  act(() => { row.click(); });
  expect(el.textContent).toContain("On the way");
  expect(el.querySelector("input[inputMode='numeric']")).toBeNull(); // no PIN modal
  expect(el.textContent).toContain("on the way"); // honest copy
});

it("Jasmine (10) taps an assigned chore: PIN modal, and a verified PIN lands PENDING (no instant points)", async () => {
  mockAuth.currentUser = { name: "Jasmine", role: "child", age: 10 };
  const row = Array.from(el.querySelectorAll("[role='button']")).find((b) => b.textContent?.includes("Feed the dog"))!;
  act(() => { row.click(); });
  const input = el.querySelector("input[inputMode='numeric']")!;
  expect(input).not.toBeNull();
  // stub verify → returns the child member record
  vi.stubGlobal("fetch", vi.fn(async (u: string) => u.includes("/api/members/verify")
    ? { ok: true, status: 200, json: async () => ({ member: { name: "Jasmine Rose", fullName: "Jasmine Rose", role: "child" } }) }
    : { ok: true, status: 200, json: async () => ({}) }));
  act(() => { /* set pin + submit per harness pattern */ });
  expect(el.textContent).toContain("On the way");
  // points NOT moved:
  expect(el.textContent).not.toContain("+5pts earned");
});

it("parent PIN-complete still earns instantly (regression guard)", async () => {
  // harness with a parent currentUser; assert the classic path unchanged
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run tests/unit/tasks-pin-free-flow.test.tsx` → Caspian test fails (PIN modal opens — `shouldUsePendingTap` requires the old signature) etc.

- [ ] **Step 3: Rewire `openPinEntry`**

Replace the pending-tap branch:

```ts
    if (completesWithoutPin(currentUser?.role, currentUser?.age, task)) {
      if (task.completedInWeek === weekKey()) return;
      const now = new Date().toISOString();
      const me = resolveMemberName(membersData, currentUser!.name);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? tapCompletePending(t, me, now, weekKey()) : t)));
      triggerConfetti();
      showToast(`Done! +${task.points}pts on the way — a parent approves.`);
      return;
    }
    // 10+ kids and anyone else hit a PIN step; child rows then wait for approval
    // (decided in submitPin from the VERIFIED member record, not the session).
```

(Delete the old `shouldUsePendingTap` import; add `completesWithoutPin`/`completesWithPendingApproval` to the task-utils import list. The 10+ kid's assigned tap falls through to `setPinTaskId(taskId)` as today — correct.)

- [ ] **Step 4: Rewire `submitPin`'s assigned-complete tail (the `!universal && !snatchable` branch)**

After `const result = await verifyPinRemote(task.assignee, pinInput); if (result.status === "ok") {` and the `normalizedName` line, insert the child branch before the earn:

```ts
      if (result.member?.role === "child") {
        // Identity verified by PIN; the parent verifies the work. Points wait.
        setTasks((prev) => prev.map((t) => (t.id === pinTaskId ? tapCompletePending(t, normalizedName, now, currentWeek) : t)));
        triggerConfetti();
        setPinInput("");
        setPinSuccess(`⏳ ${normalizedName.split(" ")[0]} — done! +${task.points}pts on the way.`);
        setTimeout(() => { setPinTaskId(null); setPinSuccess(""); }, 1500);
        return;
      }
```

- [ ] **Step 5: Update the old pending-flow fixtures**

`tests/unit/tasks-pending-flow.test.tsx`: add `age: 6` to the Caspian roster fixtures (preserves the PIN-free path those tests pin) and `age: 10` to Jasmine fixtures; where a test asserted "child tap → pending" for a member without an age, either set the age or convert the assertion to the PIN→pending path. Run: `npx vitest run tests/unit/tasks-pending-flow.test.tsx tests/unit/tasks-pin-free-flow.test.tsx tests/unit/tasks-pending-approval.test.ts tests/unit/tasks-pending-restore.test.tsx` → PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck && git add src/app/tasks/page.tsx tests/unit/tasks-pin-free-flow.test.tsx tests/unit/tasks-pending-flow.test.tsx && git commit -m "feat(tasks): under-10 taps PIN-free; 10+ kid completions wait for approval"
```

---

### Task 6: Server-authoritative claims → pending for kids

**Files:**
- Modify: `src/app/api/tasks/claim/route.ts`
- Modify: `src/app/tasks/page.tsx` (claim optimistic path ~975-1050)
- Modify: `src/modes/kid/KidHome.tsx` (claim success path ~337-410 — same optimistic shape)
- Test: `tests/unit/task-claim.test.ts` (extend)

**Interfaces:**
- Consumes: `verifyPinFromPB` (returns the member record incl. role), `tapCompletePending` client-side, PB `tasks.pendingApproval` json field (seeded 2026-09-06).
- Produces: kid claim → `{success: true, pending: true, claimedBy, task}` with NO week_data write; adult claim → unchanged immediate earn + `{weekData}`; the pending row is approvable by the existing `approvePendingCompletion` (keyed by taskId, idempotent).

- [ ] **Step 1: Write the failing route tests**

Extend `tests/unit/task-claim.test.ts` (reuse its PB mock) with:

```ts
it("child claimant → pendingApproval on the task row, no week_data earn", async () => {
  verifyPinFromPB.mockResolvedValue({ id: "k", name: "Caspian Garcia", role: "child", emoji: "🧒" });
  const res = await POST(claimReq({ taskId: 42, claimantName: "Caspian", claimantPin: "1010" }));
  const body = await res.json();
  expect(body).toMatchObject({ success: true, pending: true });
  expect(body.weekData).toBeUndefined();
  expect(pb.updateCalls.week_data).toBeUndefined(); // no earn written
  const taskPatch = pb.updateCalls.tasks.find((p: any) => p.pendingApproval);
  expect(taskPatch.pendingApproval).toMatchObject({ byName: "Caspian Garcia", points: 5 });
});

it("a second claim on the kid's pending row is still rejected", async () => {
  // seeded task already completed:true + pendingApproval → expect 409 already_completed
});

it("adult claimant keeps the instant-earn contract (regression)", async () => {
  // existing assertion untouched — passes because the child branch is opt-in by role
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run tests/unit/task-claim.test.ts` → new tests fail (no `pending` in response).

- [ ] **Step 3: Branch the route**

After `const points = Number(task.points) || 0;` (near the `isSnatch` block), insert before the week_data write:

```ts
      // Under the age rule, kid claims are pending-approval too (spec 3.4):
      // the PIN verified the claimant's identity, but points wait for a
      // parent. No week_data is touched; the approve flow (keyed by taskId,
      // reversal-aware) awards the earn later. A second claim hits the
      // completed-row guard above, so races stay single-winner.
      const claimantIsChild = claimant.role === "child";
      if (claimantIsChild) {
        await pb.collection("tasks").update(task.id, {
          assignee: normalizedName,
          assigned: normalizedName,
          assigneeEmoji: assigneeEmoji || claimant.emoji || "",
          completed: true,
          status: "done",
          completedBy: normalizedName,
          completedAt: now,
          completedInWeek: currentWeek,
          pendingApproval: { byName: normalizedName, at: now, points: amount },
        });
        return { ok: true, pending: true, claimedBy: normalizedName } as const;
      }
```

(The existing `.catch(() => {})` task-row update for adults stays as-is; the response `return NextResponse.json({ success: true, ...result })` already spreads `pending`.)

- [ ] **Step 4: Client mirrors — optimistic PENDING for kid claimants**

`src/app/tasks/page.tsx` claim success block: where it optimistically sets `completed: true ...` + `setWeekData(earn)`, wrap the weekData earn and adopt pending for children (the claimant is the signed-in kid — `currentUser?.role === "child"`):

```ts
        const kidClaim = currentUser?.role === "child";
        setTasks(prev => prev.map(t => t.id === pinTaskId
          ? (kidClaim
            ? { ...tapCompletePending({ ...t, assignee: normalizedName, assigneeEmoji: claimantEmoji }, normalizedName, now, currentWeek), completedBy: normalizedName }
            : { ...t, completed: true, completedBy: normalizedName, completedAt: now, completedInWeek: currentWeek, assignee: normalizedName, assigneeEmoji: claimantEmoji })
          : t));
        if (!kidClaim) {
          setWeekData(prev => { /* unchanged earn tx */ });
        }
        triggerConfetti();
        setPinSuccess(kidClaim
          ? `🎯 ${normalizedName.split(" ")[0]} — grabbed! +${task.points}pts on the way (parent approves).`
          : /* unchanged string */);
```

On `!res.ok` the existing snapshot rollback stays. `KidHome.tsx`'s claim branch mirrors the same `user?.role === "child"` conditional (skip the local earn tx; `celebrate()` copy: keep confetti, toast says "on the way").

- [ ] **Step 5: Run claim + page tests to verify GREEN**

Run: `npx vitest run tests/unit/task-claim.test.ts tests/unit/tasks-pin-free-flow.test.tsx tests/unit/tasks-pending-flow.test.tsx` → PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck && git add src/app/api/tasks/claim/route.ts tests/unit/task-claim.test.ts src/app/tasks/page.tsx src/modes/kid/KidHome.tsx && git commit -m "feat(tasks): server-authoritative claims become pendingApproval for kids"
```

---

### Task 7: KidHome quest wiring to the age predicates

**Files:**
- Modify: `src/modes/kid/KidHome.tsx` (quest action ~296-410)
- Modify: `tests/unit/kid-home-quest-pin-safety.test.tsx` (fixtures + expectations)

**Interfaces:**
- Consumes: `completesWithoutPin`/`completesWithPendingApproval` (Task 2), `currentUser.age` (Tasks 1/4), `verifyPinRemote`, `tapCompletePending`, claim route (Task 6 already handles server side).
- Produces: kid quest action with NO PIN when under-10 + assigned (direct `tapCompletePending` + confetti + "on the way"); with PIN then pending when 10+; universal always opens the PIN claim modal (Task 6 makes its success pending).

- [ ] **Step 1: Update the failing expectations first**

In `tests/unit/kid-home-quest-pin-safety.test.tsx`, add `age: 5` to the Caspian fixtures (preserves today's assertions: tap → pending, no PIN), then add:

```ts
it("a 10-year-old kid's quest action still asks for the PIN, then lands pending", async () => {
  mockAuth.currentUser = { name: "Emily", role: "child", age: 10 };
  // click quest → PIN modal opens; verify stub returns child; expect pending row + no local earn tx
});
```

Run: `npx vitest run tests/unit/kid-home-quest-pin-safety.test.tsx` → the 10yo test fails (current code: non-universal child without the old `shouldUsePendingTap` seam just errors out or earns).

- [ ] **Step 2: Rewire the quest handler**

Replace the `shouldUsePendingTap(user?.role, task)` branch (line ~385) with the two-predicate form, and at the quest-button entry (~306, `setQuestPinTask(task)`) short-circuit under-10 PIN-free:

```ts
    // Under-10 kids: one tap on an assigned quest completes it PIN-free —
    // pending approval, same shape as the Tasks page (no PIN modal, no round trip).
    if (completesWithoutPin(user?.role, user?.age, task) && !task.universal && !isSnatchable(task)) {
      const now = new Date().toISOString();
      const myName = resolveMemberName(db.selectMembers(), user!.name);
      const week = loadWeekData();
      const before = pointsFor(week.points, myName);
      const tasks = loadTasks().map((t: any) => (t.id === task.id ? tapCompletePending(t, myName, now, weekKey()) : t));
      saveTasks(tasks); void syncTasksToPB(tasks);
      celebrate(task.points || 0, before, { pending: true });
      setDataVersion((v) => v + 1);
      return;
    }
    if (completesWithPendingApproval(user?.role, task)) { setQuestPinTask(task); return; } // 10+ kids: PIN then pending
```

And in the quest PIN-submit child branch, after a verified `result.member?.role === "child"`: `tapCompletePending` + "on the way" toast (mirror Task 5 Step 4) instead of the local earn.

- [ ] **Step 3: Run to verify GREEN**

Run: `npx vitest run tests/unit/kid-home-quest-pin-safety.test.tsx tests/unit/kid-pin-error-paths.test.tsx` → PASS. If `celebrate` gains a `pending` option, give it a default so other callers stay untouched.

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck && git add src/modes/kid/KidHome.tsx tests/unit/kid-home-quest-pin-safety.test.tsx && git commit -m "feat(kid-home): quests follow the age predicates (under-10 tap → pending; 10+ PIN → pending)"
```

---

### Task 8: Settings age control, AGENTS.md, full gates

**Files:**
- Modify: `src/app/settings/page.tsx` (`memberForm` init ~253, edit-open ~401, save ~416-481, modal form ~1044)
- Modify: `src/lib/task-utils.ts` (delete the deprecated `shouldUsePendingTap` — call sites were migrated in Tasks 5/7)
- Modify: `tests/unit/tasks-pending-approval.test.ts` (re-point imports/calls to `completesWithoutPin(role, 7, task)` — preserves the pinned behavior for an under-10 age)
- Modify: `AGENTS.md` (snapshot + UI Change Record + contracts)
- Test: `tests/unit/settings-member-age.test.tsx` (new, render the modal + assert the input posts `age`)

**Interfaces:**
- Consumes: PATCH/POST `/api/members/admin` (already passes `patch`/`clean` through to PB — age rides along), Task 1 schema.
- Produces: editable age in Settings → Family Members; documented contracts.

- [ ] **Step 1: Write the failing test**

`tests/unit/settings-member-age.test.tsx` — render the member edit modal with an existing child member; assert an input with `aria-label="Age"` exists and its value is the member's age; change it to 9; submit; assert the PATCH body contains `age: 9` (mock fetch and read the call). Run → RED (input missing).

- [ ] **Step 2: Add the field**

`memberForm` init + edit-open carry `age: (member as any).age ?? ""`. In the modal (after the role/avatar fields, same `settings-control-panel` row grammar as the PIN field), add a number `TextField`/input labeled "Age" with `inputMode="numeric"`, helper "Under 10 signs in with one tap", validation in the existing `errors` block: `if (memberForm.age !== "" && (!/^\d{1,3}$/.test(String(memberForm.age)) || +memberForm.age < 1 || +memberForm.age > 120)) errors.age = "Age must be 1–120 (or blank).";`. Include `age: memberForm.age === "" ? undefined : Number(memberForm.age)` in the POST/PATCH bodies.

- [ ] **Step 3: Delete the deprecated predicate (call sites migrated in Tasks 5/7)**

`grep -rn "shouldUsePendingTap" src tests` must return only: the definition in `task-utils.ts`, and `tests/unit/tasks-pending-approval.test.ts`. Delete the `shouldUsePendingTap` block from `task-utils.ts`; re-point the test file's imports/calls to `completesWithoutPin(role, 7, task)` (preserving the under-10 behavior it pins). If any `src/` reference remains, a migration was missed — fix that call site per its owning task before proceeding.

- [ ] **Step 4: Verify + run the whole kid/tasks surface once more**

Run: `npx vitest run tests/unit/settings-member-age.test.tsx tests/unit/task-utils-pin-free.test.ts tests/unit/tasks-pending-approval.test.ts tests/unit/auth-quick-login-route.test.ts tests/unit/use-auth-quick-login.test.ts tests/unit/tasks-pin-free-flow.test.tsx tests/unit/task-claim.test.ts tests/unit/kid-home-quest-pin-safety.test.tsx` → PASS.

- [ ] **Step 5: Full gates**

```bash
npm run typecheck && npx eslint src/app/settings/page.tsx src/app/tasks/page.tsx src/app/api/auth/quick-login/route.ts src/hooks/useAuth.tsx src/lib/task-utils.ts src/app/api/tasks/claim/route.ts src/modes/kid/KidHome.tsx src/components/auth/MemberPickerModal.tsx && npx vitest run && npm run build
```
Expected: typecheck clean, eslint clean on touched files, suite green (the 1-4 weather-strip failures from concurrent workstreams may show — confirm red on the base commit if any, per the established convention).

- [ ] **Step 6: AGENTS.md (mandatory same-session doc update)**

Commit the code first:

```bash
git add src/app/settings/page.tsx src/lib/task-utils.ts tests/unit/settings-member-age.test.tsx tests/unit/tasks-pending-approval.test.ts && git commit -m "feat(settings): member age control; delete deprecated shouldUsePendingTap seam"
```

Then docs: add a **Last Updated** snapshot entry + a **UI Change Record** (2026-09-09 — "Under-10 kids: one-tap sign-in + PIN-free chore taps; all kid completions wait for parent approval") describing: the `quick-login` fail-closed contract (`PIN_FREE_MAX_AGE` single source; server is the only decider), the predicates as the only kid-action seams (`shouldUsePendingTap` gone), the kid-claim pending contract on the claim route (no week_data touch; `pendingApproval` on the task row; approve reuses the existing idempotent flow), roster `age` as parent-edited data, and the Jasmine-at-10 boundary. Then commit.

```bash
git add AGENTS.md docs/superpowers/plans/2026-09-09-age-based-pin-free-tasks.md && git commit -m "docs(agents): under-10 PIN-free task flow contracts"
```

- [ ] **Step 7: Deploy prompt (SOP-005)**

Ask the human: "Deploy to NAS now?" If yes: push both remotes (run `bash scripts/security/push-safe.sh` first), then `DEPLOY_NAS_LOCAL.md`: tar-sync → `docker build` → rename-swap → **`npm run pb:seed` (adds members.age) → `node scripts/consuela/set-member-ages.mjs` once** → smoke (`/api/auth/quick-login` with Caspian → 200 cookie; with Jasmine → 403).
