// @vitest-environment node
//
// GET /api/muse/docs (Task 10 / B3). Unauthenticated markdown read of
// docs/muse-api.md at request time — no family data.
import { describe, it, expect } from "vitest";

import { GET } from "@/app/api/muse/docs/route";

describe("GET /api/muse/docs", () => {
  it("serves the API reference as markdown without authentication", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") || "";
    expect(contentType).toContain("text/markdown");
    expect(contentType).toContain("charset=utf-8");
    const body = await res.text();
    expect(body).toContain("POST /api/muse/auth/login");
  });
});
