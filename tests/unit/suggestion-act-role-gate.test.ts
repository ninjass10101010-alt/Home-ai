import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const verifyPinAgainstAnyMember = vi.fn();
const getTool = vi.fn();
const selectPendingSuggestions = vi.fn();
const updateSuggestion = vi.fn();

vi.mock("@/lib/server-auth", () => ({
  verifyPinAgainstAnyMember: (...a: unknown[]) => verifyPinAgainstAnyMember(...a),
}));
vi.mock("@/lib/hermes-tools", () => ({
  getTool: (...a: unknown[]) => getTool(...a),
}));
vi.mock("@/db", () => ({
  db: {
    selectPendingSuggestions: (...a: unknown[]) => selectPendingSuggestions(...a),
    updateSuggestion: (...a: unknown[]) => updateSuggestion(...a),
  },
}));

import { POST } from "@/app/api/consuela/suggestions/act/route";

function req(tool: string) {
  const body = {
    id: "s1",
    actionPayload: { tool, args: {} },
  };
  return new NextRequest("http://localhost/api/consuela/suggestions/act", {
    method: "POST",
    headers: { "x-consuela-pin": "1234", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const parent = { id: "p1", name: "Rebecca", role: "parent" };
const child = { id: "c1", name: "Caspian", role: "child" };

function mockSuggestion(tool: string) {
  selectPendingSuggestions.mockResolvedValue([
    { id: "s1", actionPayload: { tool, args: {} } },
  ]);
}

beforeEach(() => {
  verifyPinAgainstAnyMember.mockReset();
  getTool.mockReset();
  selectPendingSuggestions.mockReset();
  updateSuggestion.mockReset();
  getTool.mockReturnValue({ handler: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })) });
});

describe("POST /api/consuela/suggestions/act — child PIN cannot dispatch write tools", () => {
  it("child pin + write tool (add_task) → 403 adult_only, tool never dispatched", async () => {
    verifyPinAgainstAnyMember.mockResolvedValue(child);
    mockSuggestion("add_task");
    const res = await POST(req("add_task"));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("adult_only");
    expect(getTool).not.toHaveBeenCalled();
    expect(updateSuggestion).not.toHaveBeenCalled();
  });

  it.each(["add_grocery_item", "complete_task", "complete_grocery_item", "add_event", "remove_event"])(
    "child pin + %s → 403",
    async (tool) => {
      verifyPinAgainstAnyMember.mockResolvedValue(child);
      mockSuggestion(tool);
      const res = await POST(req(tool));
      expect(res.status).toBe(403);
      expect(getTool).not.toHaveBeenCalled();
    },
  );

  it("child pin + read tool (get_grocery_list) still allowed", async () => {
    verifyPinAgainstAnyMember.mockResolvedValue(child);
    mockSuggestion("get_grocery_list");
    const res = await POST(req("get_grocery_list"));
    expect(res.status).toBe(200);
    expect(getTool).toHaveBeenCalled();
  });

  it("parent pin + write tool works", async () => {
    verifyPinAgainstAnyMember.mockResolvedValue(parent);
    mockSuggestion("add_task");
    const res = await POST(req("add_task"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("child pin + dismiss_suggestion allowed (kid can dismiss their own feed)", async () => {
    verifyPinAgainstAnyMember.mockResolvedValue(child);
    mockSuggestion("dismiss_suggestion");
    const res = await POST(req("dismiss_suggestion"));
    expect(res.status).toBe(200);
  });
});
