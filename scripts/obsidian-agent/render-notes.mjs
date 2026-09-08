// Pure renderer for the Consuela memory → Obsidian mirror (zero deps).
// Shared by consuela-memory-agent.mjs and tests/unit/obsidian-render-notes.test.ts.

export function slugify(text) {
  const slug = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 60) || "memory";
}

export function personOf(memory) {
  return Array.isArray(memory.tags) && memory.tags.length > 0 ? String(memory.tags[0]) : "General";
}

function yq(value) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function renderNote(memory) {
  const person = personOf(memory);
  const frontmatter = [
    "---",
    `title: ${yq(memory.content.slice(0, 80))}`,
    // id/category raw: PB ids + slugged categories are always YAML-safe, and
    // the unit contract asserts the unquoted form ("id: m1").
    `id: ${memory.id}`,
    `category: ${memory.category}`,
    `person: ${yq(person)}`,
    `created: ${yq(memory.createdAt)}`,
    `updated: ${yq(memory.updatedAt)}`,
    `usage: ${memory.usageCount ?? 0}`,
    `source: consuela-dashboard`,
    "---",
    "",
    memory.content,
    "",
    `> Imported by Consuela — edit in the dashboard, not here. (One-way mirror; PocketBase is the source of truth.)`,
    "",
  ].join("\n");
  return frontmatter;
}

export function notePath(memory) {
  // {category}/{person-or-General}/{slug}.md — relative to the vault mirror root.
  return [String(memory.category || "note"), personOf(memory), `${slugify(memory.content)}.md`].join("/");
}

export function renderIndex(category, memories) {
  const lines = [
    `# Consuela Memory — ${category}`,
    "",
    `Auto-mirrored from the Consuela dashboard. ${memories.length} memor${memories.length === 1 ? "y" : "ies"}.`,
    "",
    ...memories.map((m) => `- [[${slugify(m.content)}.md]] — ${m.content.slice(0, 80)}`),
    "",
  ];
  return lines.join("\n");
}
