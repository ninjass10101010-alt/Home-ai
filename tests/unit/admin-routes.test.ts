import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  listContainers: vi.fn(),
  restartContainer: vi.fn(),
  verifyPinAgainstAnyMember: vi.fn(),
}));

vi.mock("@/lib/docker-api", () => ({
  listContainers: mocks.listContainers,
  restartContainer: mocks.restartContainer,
}));

vi.mock("@/lib/server-auth", () => ({
  verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember,
}));

// version route reads fs + GitHub; stub both to stay hermetic
vi.mock("fs/promises", () => ({
  readFile: vi.fn(async () => {
    throw new Error("no file");
  }),
}));
vi.stubGlobal(
  "fetch",
  vi.fn(() => Promise.reject(new Error("offline")))
);

import { GET as versionGET } from "@/app/api/admin/version/route";
import { GET as containersGET } from "@/app/api/admin/containers/route";
import { POST as restartPOST } from "@/app/api/admin/restart/route";
import { POST as updatePOST } from "@/app/api/admin/update/route";

function req(init: { headers?: Record<string, string>; body?: unknown } = {}): NextRequest {
  return new NextRequest("http://localhost/api/admin/x", {
    method: init.body ? "POST" : "GET",
    headers: init.headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

beforeEach(() => {
  vi.stubEnv("ADMIN_SECRET", "");
  mocks.listContainers.mockReset().mockResolvedValue([]);
  mocks.restartContainer.mockReset().mockResolvedValue(undefined);
});

describe("admin routes auth gate", () => {
  it.each([
    ["version", () => versionGET(req())],
    ["containers", () => containersGET(req())],
    ["update", () => updatePOST(req({ body: {} }))],
    [
      "restart",
      () => restartPOST(req({ body: { container: "pocketbase" } })),
    ],
  ])("%s returns 401 without credentials", async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it.each([
    ["containers", () => containersGET(req({ headers: { authorization: "Bearer adm-s3cret" } }))],
    ["restart", () => restartPOST(req({ headers: { authorization: "Bearer adm-s3cret" }, body: { container: "pocketbase" } }))],
  ])("%s succeeds with the ADMIN_SECRET bearer", async (_name, call) => {
    vi.stubEnv("ADMIN_SECRET", "adm-s3cret");
    if (_name === "restart") mocks.restartContainer.mockResolvedValue(undefined);
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("restart rejects a child PIN with 403 even when the PIN is valid", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "kid", role: "child" });
    const res = await restartPOST(
      req({ headers: { "x-admin-pin": "1111" }, body: { container: "pocketbase" } })
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("adult_only");
    expect(mocks.restartContainer).not.toHaveBeenCalled();
  });

  it("restart allows an adult PIN and performs the restart", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "dad", role: "parent" });
    const res = await restartPOST(
      req({ headers: { "x-admin-pin": "2222" }, body: { container: "pocketbase" } })
    );
    expect(res.status).toBe(200);
    expect(mocks.restartContainer).toHaveBeenCalledWith("pocketbase");
  });
});
