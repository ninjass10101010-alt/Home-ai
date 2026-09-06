// @vitest-environment node
// Kid soul contract — a child session must get the kid voice AND the kid
// tool surface; parents keep the adult soul untouched.
import {
  KID_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  buildConsuelaSystemPrompt,
  buildKidSystemPrompt,
} from "@/lib/consuela-prompts";
import { buildToolsForOpenAI } from "@/lib/hermes-tools";

const kidToolNames = () =>
  buildToolsForOpenAI({ role: "child" }).map((t) => t.function.name).sort();
const adultToolNames = () =>
  buildToolsForOpenAI({ role: "parent" }).map((t) => t.function.name).sort();

describe("kid soul prompt", () => {
  it("exists and is kid-friendly, not the adult soul", () => {
    expect(KID_SYSTEM_PROMPT).toBeTruthy();
    expect(KID_SYSTEM_PROMPT).not.toContain("cross-section");
    expect(KID_SYSTEM_PROMPT.length).toBeGreaterThan(200);
  });

  it("names the kid when a name is provided", () => {
    const p = buildKidSystemPrompt(new Date("2026-09-06T12:00:00"), "Emily");
    expect(p).toContain("Emily");
    expect(p).toContain("Sun, 2026-09-06");
  });

  it("carries the same date grounding block as the adult prompt", () => {
    const now = new Date("2026-09-06T12:00:00");
    const kid = buildKidSystemPrompt(now, "Emily");
    const adult = buildConsuelaSystemPrompt(now);
    expect(kid).toContain("Today is Sun, 2026-09-06");
    expect(adult).toContain("Today is Sun, 2026-09-06");
    // The kid prompt never names a write tool (kids have none).
    expect(kid).not.toContain("add_meal tool");
    expect(adult).toContain("add_meal tool");
  });

  it("locks the kid scope: dashboard Q&A + summaries + learning, nothing else", () => {
    expect(KID_SYSTEM_PROMPT).toMatch(/friendl|kind|fun/i);
    expect(KID_SYSTEM_PROMPT).toMatch(/dashboard/i);
    expect(KID_SYSTEM_PROMPT).toMatch(/learn/i);
    expect(KID_SYSTEM_PROMPT).toMatch(/ask a parent|parents/i);
    expect(KID_SYSTEM_PROMPT).toMatch(/no swearing|never swear/i);
    expect(KID_SYSTEM_PROMPT).toMatch(/internet/i);
    expect(KID_SYSTEM_PROMPT).toMatch(/PIN|password|address/i);
  });

  it("adult prompt is unchanged by kid work", () => {
    expect(SYSTEM_PROMPT).toContain("You are Consuela");
    expect(SYSTEM_PROMPT).toContain("Admin capabilities");
    expect(buildConsuelaSystemPrompt(new Date("2026-09-06T12:00:00"))).toContain(
      "Today is Sun, 2026-09-06"
    );
  });
});

describe("kid tool surface", () => {
  it("reads + summaries only — every write, admin, and logistics tool is gone", () => {
    const names = kidToolNames();
    expect(names).toEqual([
      "get_dashboard_summary",
      "get_family_members",
      "get_grocery_list",
      "get_leaderboard",
      "get_pantry",
      "get_pending_tasks",
      "get_proactive_suggestions",
      "get_recipes",
      "get_todays_events",
      "get_todays_schedule",
      "get_weather",
      "get_weekly_meals",
    ]);
  });

  it("blocks kid-unsafe tools explicitly", () => {
    const names = kidToolNames();
    for (const blocked of [
      "add_task", "complete_task", "add_event", "remove_event", "add_meal",
      "add_grocery_item", "complete_grocery_item",
      "dismiss_suggestion", "action_suggestion",
      "check_for_update", "trigger_update", "get_container_status",
      "restart_container", "check_pocketbase",
      "check_conflicts", "suggest_buffers", "create_buffers",
      "ha_list_devices", "ha_control_device", "compare_grocery_prices",
    ]) {
      expect(names).not.toContain(blocked);
    }
  });

  it("parent surface is unchanged (still has writes + admin + house)", () => {
    const names = adultToolNames();
    for (const kept of [
      "add_task", "complete_task", "add_grocery_item",
      "get_container_status", "ha_control_device",
    ]) {
      expect(names).toContain(kept);
    }
    expect(names).not.toContain("not-a-real-tool");
  });

  it("legacy houseControl flag still works (no role = adult)", () => {
    const names = buildToolsForOpenAI({ houseControl: false }).map((t) => t.function.name);
    expect(names).toContain("add_task");
    expect(names).not.toContain("ha_control_device");
  });
});
