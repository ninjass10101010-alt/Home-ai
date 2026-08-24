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

// One stable mock instance per test: `collection(anyName)` always hands routes
// the same fns so assertions below can observe the calls routes actually made.
function makeCollectionMocks() {
  return {
    getFullList: vi.fn(async () => [{ id: "r1", name: "Milk", pin: "SHOULD_NOT_EXIST" }]),
    create: vi.fn(async (row: any, _opts?: unknown) => ({ id: "new1", ...row })),
    getOne: vi.fn(async () => ({ id: "r1", done: false })),
    update: vi.fn(async (_id: string, row: any) => ({ id: "r1", ...row })),
    delete: vi.fn(async () => ({})),
  };
}
let col = makeCollectionMocks();
const pbOk = { collection: (_name?: string) => col };

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  col = makeCollectionMocks();
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
