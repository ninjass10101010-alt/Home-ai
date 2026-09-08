import { describe, it, expect } from "vitest";
import {
  slugify,
  sanitizeSegment,
  noteFilename,
  notePath,
  renderNote,
  renderIndex,
} from "../../scripts/obsidian-agent/render-notes.mjs";

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

describe("sanitizeSegment", () => {
  it("never lets a path separator through (folders can't nest)", () => {
    expect(sanitizeSegment("Bailey/Smith")).not.toContain("/");
  });
  it("falls back to General when nothing survives (e.g. '..')", () => {
    expect(sanitizeSegment("..")).toBe("General");
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
    // Filenames are now id-stable: {content-slug(40)}-{id(12)}.md (fix round).
    expect(idx).toContain("bailey-is-allergic-to-peanuts-m1.md");
  });
});

describe("noteFilename / notePath — id-stable filenames", () => {
  it("same id with changed content keeps the same id segment (overwrite-not-orphan)", () => {
    const before = noteFilename(memory);
    const after = noteFilename({ ...memory, content: "Bailey is allergic to peanuts AND tree nuts" });
    expect(before).toContain("-m1.md");
    expect(after).toContain("-m1.md"); // id suffix pins the note's identity
    expect(after.endsWith("-m1.md")).toBe(true);
  });
  it("paths stay single-segment per part with sanitized person/category", () => {
    const p = notePath({ ...memory, tags: ["Bailey/Smith"], category: "allergy/food" });
    expect(p.split("/")).toHaveLength(3);
    expect(p).toContain("bailey-smith");
    expect(p).toContain("allergy-food");
  });
});
