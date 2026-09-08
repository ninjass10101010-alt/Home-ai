import { describe, it, expect } from "vitest";
import { slugify, renderNote, renderIndex } from "../../scripts/obsidian-agent/render-notes.mjs";

const memory = {
  id: "m1",
  category: "allergy",
  key: "bailey_allergic_to_peanuts",
  content: "Bailey is allergic to peanuts",
  tags: ["Bailey"],
  createdAt: "2026-09-07T00:00:00Z",
  updatedAt: "2026-09-07T01:00:00Z",
  usageCount: 2,
  lastUsed: "2026-09-07T01:00:00Z",
};

describe("slugify", () => {
  it("makes filesystem-safe slugs, capped at 60 chars", () => {
    expect(slugify("Bailey is allergic to peanuts!")).toBe("bailey-is-allergic-to-peanuts");
    expect(slugify("x".repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe("renderNote", () => {
  it("renders frontmatter + body + one-way footer", () => {
    const note = renderNote(memory);
    expect(note).toContain("---");
    expect(note).toContain("id: m1");
    expect(note).toContain("category: allergy");
    expect(note).toContain('person: "Bailey"');
    expect(note).toContain("usage: 2");
    expect(note).toContain("Bailey is allergic to peanuts");
    expect(note).toContain("edit in the dashboard, not here");
  });
  it("routes untagged memories to General", () => {
    const note = renderNote({ ...memory, tags: [] });
    expect(note).toContain('person: "General"');
  });
});

describe("renderIndex", () => {
  it("lists the notes in the folder", () => {
    const idx = renderIndex("allergy", [memory]);
    expect(idx).toContain("# Consuela Memory — allergy");
    expect(idx).toContain("bailey-is-allergic-to-peanuts.md");
  });
});
