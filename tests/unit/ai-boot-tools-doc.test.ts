// The PROMPT surface is what actually reaches the model — the tool definition
// is only the OpenAI-schema copy. `ai/TOOLS.md` is embedded at prebuild into
// `src/lib/ai-boot.generated.ts` and composes `SYSTEM_PROMPT`, so a claim can be
// unenforced in the code AND still be taught to the assistant here.
//
// Two independent guards:
//   1. SYNC — the committed generated artifact must byte-match the `ai/` sources,
//      so editing a boot file without regenerating fails the suite instead of
//      shipping a stale prompt.
//   2. TRUTH — the composed parent prompt must not teach a restriction the code
//      does not enforce.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { AI_BOOT } from "@/lib/ai-boot.generated";
import { SYSTEM_PROMPT, buildConsuelaSystemPrompt } from "@/lib/consuela-prompts";
import { getTool } from "@/lib/hermes-tools";

const BOOT_FILES = {
  SOUL_MD: "SOUL.md",
  IDENTITY_MD: "IDENTITY.md",
  TOOLS_MD: "TOOLS.md",
  KID_MD: "KID.md",
} as const;

const readBootFile = (name: string) =>
  readFileSync(resolve(__dirname, "../../ai", name), "utf8").trim();

const docRow = (doc: string, tool: string) => {
  const line = doc.split("\n").find((l) => l.trimStart().startsWith(`| \`${tool}\` |`));
  return line ?? "";
};

describe("ai-boot generated artifact is in sync with its sources", () => {
  it.each(Object.entries(BOOT_FILES))("%s matches ai/%s", (key, file) => {
    expect(AI_BOOT[key as keyof typeof BOOT_FILES]).toBe(readBootFile(file));
  });
});

describe("the parent prompt reaches the model verbatim", () => {
  it("SYSTEM_PROMPT embeds the current TOOLS.md", () => {
    expect(SYSTEM_PROMPT).toContain(AI_BOOT.TOOLS_MD);
    expect(buildConsuelaSystemPrompt(new Date("2026-09-21T12:00:00Z"))).toContain(AI_BOOT.TOOLS_MD);
  });
});

describe("delete_task: the prompt teaches only what the code enforces", () => {
  // The code applies NO classification: it reads a row, refuses only a
  // COMPLETED row, and dispatches the delete. Any assigned-only wording here
  // makes the assistant refuse legitimate open/crew deletes.
  const row = docRow(AI_BOOT.TOOLS_MD, "delete_task");
  const surfaces: Array<[string, string]> = [
    ["ai/TOOLS.md", docRow(readBootFile("TOOLS.md"), "delete_task")],
    ["AI_BOOT.TOOLS_MD", row],
    ["SYSTEM_PROMPT", SYSTEM_PROMPT.split("\n").find((l) => l.trimStart().startsWith("| `delete_task` |")) ?? ""],
    ["tool.definition.description", getTool("delete_task")!.definition.description],
  ];

  it.each(surfaces)("%s states the delete is not classification-restricted", (_name, text) => {
    expect(text).not.toBe("");
    expect(text).not.toContain("ASSIGNED");
    expect(text).not.toContain("not open");
    expect(text).not.toContain("not crew");
  });

  it("ai/TOOLS.md says the open/crew truth outright", () => {
    expect(row).toContain("No classification is applied");
  });
});

describe("complete_task / reopen_task: the prompt matches the enforced refusals", () => {
  // Every one of these IS enforced in the tool, so they are pinned here to keep
  // the prompt and the code from drifting apart in either direction.
  it("complete_task routes open, late-stealable and crew chores away from chat", () => {
    const row = docRow(AI_BOOT.TOOLS_MD, "complete_task");
    expect(row).toContain("CLAIMED from the Tasks screen");
    expect(row).toContain("crew chore needs every member to check in");
    expect(row).toContain("grown-up's own chore is completed in the Tasks UI");
  });

  it("reopen_task states the crew-preservation the claim seam actually performs", () => {
    const row = docRow(AI_BOOT.TOOLS_MD, "reopen_task");
    expect(row).toContain("keeps its members");
    expect(row).toContain("`joinedAt`");
    expect(row).toContain("`removed`");
    expect(row).toContain("`checkedInAt`");
  });
});
