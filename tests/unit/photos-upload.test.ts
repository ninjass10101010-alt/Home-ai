// POST /api/photos/upload — the 100 MB ceiling (spec §6) and the validation
// matrix around it. Route-level with the PB seam (withAdmin) and the session
// verifier mocked, mirroring tests/unit/celebrate-win-route.test.ts.
//
// The three literals that used to drift apart — route constant, uploader
// constant/error string, schema `maxSize` — are pinned here by reading their
// SOURCE (the same idiom tests/unit/tap-target-contract.test.ts uses): a
// refactor that re-inlines the number anywhere fails this suite.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifySession: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "consuela_session",
  verifySession: (token?: string) => mocks.verifySession(token),
}));

import { POST } from "@/app/api/photos/upload/route";
import { ALLOWED_IMAGE_TYPES, MAX_ORIGINAL_BYTES } from "@/lib/photos/upload-limits";

const SESSION = "parent|Rebecca Garcia|m-reb";
const MB = 1024 * 1024;

/** Real NextRequest with a real multipart body (small payloads). */
function uploadReq(form: FormData, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/photos/upload", {
    method: "POST",
    body: form,
    headers: { cookie: `consuela_session=${SESSION}`, ...headers },
  });
}

/**
 * Request stub for the large-body cases: the route only reads `cookies`,
 * `headers.get("content-length")` and `formData()`. Stubbing `formData` keeps
 * a 100 MB boundary test from serialising + re-parsing the multipart body,
 * and lets this suite assert an oversized body is rejected WITHOUT buffering.
 */
function stubReq(form: FormData, headers: Record<string, string> = {}) {
  const formData = vi.fn(async () => form);
  const req = {
    headers: new Headers(headers),
    cookies: { get: (name: string) => (name === "consuela_session" ? { value: SESSION } : undefined) },
    formData,
  } as unknown as NextRequest;
  return { req, formData };
}

function formOf(over: { file?: File; wall?: File | Blob; takenAt?: string } = {}): FormData {
  const form = new FormData();
  const file = over.file ?? new File([new Uint8Array([1, 2, 3])], "pic.jpg", { type: "image/jpeg" });
  form.set("original", file);
  if (over.wall) form.set("wall", over.wall);
  form.set("takenAt", over.takenAt ?? "2026-09-30T12:00:00.000Z");
  return form;
}

function bigFile(bytes: number, type = "image/jpeg"): File {
  return new File([new ArrayBuffer(bytes)], `big-${bytes}.jpg`, { type });
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.verifySession.mockReset();
  mocks.verifySession.mockImplementation(async (token?: string) =>
    token && token !== "bogus" ? { role: "parent", name: "Rebecca Garcia", memberId: "m-reb" } : null,
  );
  mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) =>
    fn({ collection: () => ({ create: async (data: Record<string, unknown>) => ({ id: "p1", ...data }) }) }),
  );
});

describe("100 MB boundary", () => {
  it("accepts a file exactly at 104857600 bytes", async () => {
    const { req } = stubReq(formOf({ file: bigFile(MAX_ORIGINAL_BYTES) }));
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mocks.withAdmin).toHaveBeenCalledTimes(1);
  });

  it("413s one byte over with file_too_large", async () => {
    const { req } = stubReq(formOf({ file: bigFile(MAX_ORIGINAL_BYTES + 1) }));
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, error: "file_too_large" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("413s an oversized Content-Length BEFORE buffering the body into formData", async () => {
    const { req, formData } = stubReq(formOf(), {
      "content-length": String(MAX_ORIGINAL_BYTES + 9 * MB),
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, error: "file_too_large" });
    expect(formData).not.toHaveBeenCalled();
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });
});

describe("validation", () => {
  it("400s a malformed takenAt with invalid_taken_at", async () => {
    const res = await POST(uploadReq(formOf({ takenAt: "not-a-date" })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_taken_at" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("400s a wall copy whose MIME type is not on the allowlist", async () => {
    const wall = new File([new Uint8Array([9])], "wall.gif", { type: "image/gif" });
    const res = await POST(uploadReq(formOf({ wall })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "unsupported_wall_type" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("401s with no session", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/photos/upload", { method: "POST", body: formOf() }),
    );
    expect(res.status).toBe(401);
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("accepts a small upload with an allowlisted wall type", async () => {
    const wall = new File([new Uint8Array([9])], "wall.jpg", { type: "image/jpeg" });
    const res = await POST(uploadReq(formOf({ wall })));
    expect(res.status).toBe(201);
  });
});

describe("shared-constant parity (spec §6: one export, no re-inlined literals)", () => {
  const root = process.cwd();
  const read = (rel: string) => readFileSync(join(root, rel), "utf8");
  const limitsSrc = read("src/lib/photos/upload-limits.ts");
  const schemaSrc = read("src/db/features/photos.ts");
  const routeSrc = read("src/app/api/photos/upload/route.ts");
  const uploaderSrc = read("src/components/photos/PhotoUploader.tsx");

  it("upload-limits.ts declares 100 * 1024 * 1024 and the five-type allowlist", () => {
    expect(limitsSrc).toMatch(/MAX_ORIGINAL_BYTES\s*=\s*100\s*\*\s*1024\s*\*\s*1024/);
    expect(limitsSrc).toMatch(/MAX_WALL_BYTES\s*=\s*8\s*\*\s*1024\s*\*\s*1024/);
    expect(MAX_ORIGINAL_BYTES).toBe(104857600);
    expect([...ALLOWED_IMAGE_TYPES]).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ]);
  });

  it("the schema's original maxSize is the same number", () => {
    expect(schemaSrc).toMatch(/name:\s*'original'[^}]*maxSize:\s*104857600/);
  });

  it("the upload route reads the shared constant (no local 20 MB copy left)", () => {
    expect(routeSrc).toMatch(/import\s*\{[^}]*MAX_ORIGINAL_BYTES[^}]*\}\s*from\s*"@\/lib\/photos\/upload-limits"/);
    expect(routeSrc).not.toMatch(/20\s*\*\s*1024\s*\*\s*1024/);
    expect(routeSrc).not.toMatch(/const\s+MAX_ORIGINAL_BYTES\s*=/);
  });

  it("the uploader reads the shared constant and shows the 100MB string", () => {
    expect(uploaderSrc).toMatch(/import\s*\{[^}]*MAX_ORIGINAL_BYTES[^}]*\}\s*from\s*"@\/lib\/photos\/upload-limits"/);
    expect(uploaderSrc).not.toMatch(/const\s+MAX_BYTES\s*=/);
    expect(uploaderSrc).toContain("Larger than 100MB");
    expect(uploaderSrc).not.toContain("Larger than 20MB");
    // Client guard uses the exact allowlist, not a loose `image/` prefix.
    expect(uploaderSrc).toMatch(/isAllowedImageType\(/);
    expect(uploaderSrc).not.toMatch(/startsWith\("image\/"\)/);
  });
});
