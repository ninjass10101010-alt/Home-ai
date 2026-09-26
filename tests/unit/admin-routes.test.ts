import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  listContainers: vi.fn(),
  restartContainer: vi.fn(),
  verifyPinAgainstAnyMember: vi.fn(),
  authorizeAdminRequest: vi.fn(),
  execSync: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("@/lib/docker-api", () => ({
  listContainers: mocks.listContainers,
  restartContainer: mocks.restartContainer,
}));

vi.mock("@/lib/server-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server-auth")>();
  return { ...actual, verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember };
});

vi.mock("@/lib/admin-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-auth")>();
  return { ...actual, authorizeAdminRequest: mocks.authorizeAdminRequest };
});

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execSync: mocks.execSync };
});

// version route reads fs + GitHub; stub both to stay hermetic
vi.mock("fs/promises", () => ({ readFile: mocks.readFile }));
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

beforeEach(async () => {
  vi.stubEnv("ADMIN_SECRET", "");
  mocks.listContainers.mockReset().mockResolvedValue([]);
  mocks.restartContainer.mockReset().mockResolvedValue(undefined);
  mocks.execSync.mockReset().mockReturnValue("");
  mocks.readFile.mockReset().mockRejectedValue(new Error("no file"));
  const actual = await vi.importActual<typeof import("@/lib/admin-auth")>("@/lib/admin-auth");
  mocks.authorizeAdminRequest
    .mockReset()
    .mockImplementation(actual.authorizeAdminRequest);
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

  it("returns 410 and runs no deployment command", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: true });
    const res = await updatePOST(req({ body: {} }));

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({
      ok: false,
      error: "manual_deploy_required",
    });
    expect(mocks.execSync).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("returns 410 for a real ADMIN_SECRET bearer and spawns no process", async () => {
    vi.stubEnv("ADMIN_SECRET", "adm-s3cret");
    const res = await updatePOST(
      req({ headers: { authorization: "Bearer adm-s3cret" }, body: {} })
    );

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({
      ok: false,
      error: "manual_deploy_required",
    });
    expect(mocks.execSync).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("returns 410 for an authorized parent PIN and spawns no process", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "dad", role: "parent" });
    const res = await updatePOST(
      req({ headers: { "x-admin-pin": "2222" }, body: {} })
    );

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({
      ok: false,
      error: "manual_deploy_required",
    });
    expect(mocks.verifyPinAgainstAnyMember).toHaveBeenCalledWith("2222");
    expect(mocks.execSync).not.toHaveBeenCalled();
    expect(mocks.restartContainer).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it.each([
    ["version", () => versionGET(req())],
    ["update", () => updatePOST(req({ body: {} }))],
  ])(
    "%s answers 401 when a refusal carries no status",
    async (_name, call) => {
      mocks.authorizeAdminRequest.mockResolvedValue({
        ok: false,
        error: "unauthorized",
      });
      const res = await call();
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("unauthorized");
    }
  );
});
