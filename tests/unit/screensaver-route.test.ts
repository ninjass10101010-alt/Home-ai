import { it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const compose = vi.fn();
vi.mock("@/lib/screensaver/payload", () => ({
  composeScreensaverPayload: (...a: unknown[]) => compose(...a),
}));

import { GET, POST } from "@/app/api/consuela/screensaver/route";

const payload = {
  ok: true,
  generatedAt: "2026-09-07T19:00:00.000Z",
  date: "2026-09-07",
  events: [{ title: "Soccer", time: "4:00 PM", allDay: false }],
  dinner: { name: "Tacos" },
  tasks: { done: 6, total: 11 },
  briefing: ["📅 3 events today"],
  weather: { tempF: 72, hiF: 78, loF: 61, condition: "Clear" },
};

// Block body on purpose: mockReset() returns the mock itself, and vitest
// treats a function returned from a hook as a teardown callback — the
// concise-arrow form would re-invoke the (rejected) mock after every test.
beforeEach(() => {
  compose.mockReset();
});

it("GET serves the payload to a guest (no cookie)", async () => {
  compose.mockResolvedValue(payload);
  const res = await GET(new NextRequest("http://localhost/api/consuela/screensaver"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(payload);
});

it("PB failure → honest 503 JSON", async () => {
  compose.mockRejectedValue(new Error("pb down"));
  const res = await GET(new NextRequest("http://localhost/api/consuela/screensaver"));
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ ok: false, error: "db_unreachable" });
});

it("POST → 405", async () => {
  const res = await POST(new NextRequest("http://localhost/api/consuela/screensaver", { method: "POST" }));
  expect(res.status).toBe(405);
});

it("payload carries no sensitive keys", async () => {
  compose.mockResolvedValue(payload);
  const res = await GET(new NextRequest("http://localhost/api/consuela/screensaver"));
  const text = JSON.stringify(await res.json()).toLowerCase();
  for (const banned of ["pin", "secret", "password", "token", "ledger", "contact", "assignee", "emoji"]) {
    expect(text).not.toContain(banned);
  }
});
