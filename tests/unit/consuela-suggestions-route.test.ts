import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const selectPendingSuggestions = vi.fn();
const verifySession = vi.fn();
vi.mock("@/db", () => ({ db: { selectPendingSuggestions: (...a: unknown[]) => selectPendingSuggestions(...a) } }));
vi.mock("@/lib/session", () => ({
  verifySession: (...a: unknown[]) => verifySession(...a),
  SESSION_COOKIE: "consuela_session",
}));

import { GET } from "@/app/api/consuela/suggestions/route";

function req(limit = "20") {
  return new NextRequest(`http://localhost/api/consuela/suggestions?limit=${limit}`, {
    headers: { cookie: "consuela_session=x" },
  });
}
const row = (kind: string, i: number) => ({ id: `${kind}-${i}`, kind, title: `${kind} ${i}` });

beforeEach(() => {
  selectPendingSuggestions.mockReset();
  verifySession.mockReset();
});

describe("GET /api/consuela/suggestions — role-aware limit", () => {
  it("child: fetches wide, drops parent-only kinds, THEN applies the limit (no starvation)", async () => {
    verifySession.mockResolvedValue({ role: "child" });
    // 150 pantry_low (parent-only) + 60 task_penalty_streak (kid-relevant)
    const rows = [...Array(150).keys()].map((i) => row("pantry_low", i)).concat(rowMany("task_penalty_streak", 60));
    selectPendingSuggestions.mockResolvedValue(rows);
    const res = await GET(req("20"));
    const { items } = await res.json();
    expect(selectPendingSuggestions).toHaveBeenCalledWith({ limit: 200 });
    expect(items).toHaveLength(20);
    expect(items.every((s: any) => s.kind === "task_penalty_streak")).toBe(true);
  });

  it("parent: applies the requested limit directly, no filtering", async () => {
    verifySession.mockResolvedValue({ role: "parent" });
    const rows = [...rowMany("pantry_low", 10), ...rowMany("task_penalty_streak", 10)];
    selectPendingSuggestions.mockResolvedValue(rows);
    const res = await GET(req("20"));
    const { items } = await res.json();
    expect(selectPendingSuggestions).toHaveBeenCalledWith({ limit: 20 });
    expect(items).toHaveLength(20);
    expect(items.some((s: any) => s.kind === "pantry_low")).toBe(true);
  });

  it("guest (no session): full list, no role filter", async () => {
    verifySession.mockResolvedValue(null);
    selectPendingSuggestions.mockResolvedValue(rowMany("grocery_store_optimization", 5));
    const res = await GET(req("20"));
    const { items } = await res.json();
    expect(selectPendingSuggestions).toHaveBeenCalledWith({ limit: 20 });
    expect(items).toHaveLength(5);
  });
});

function rowMany(kind: string, n: number) {
  return [...Array(n).keys()].map((i) => row(kind, i));
}
