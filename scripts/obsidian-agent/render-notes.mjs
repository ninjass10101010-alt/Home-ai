// Pure renderer for the Consuela memory → Obsidian mirror (zero deps).
// Shared by consuela-memory-agent.mjs and tests/unit/obsidian-render-notes.test.ts.

function rawSlug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function slugify(text) {
  return rawSlug(text).slice(0, 60) || "memory";
}

// Filesystem-safe single path segment: same slug pipeline as slugify but the
// empty fallback is "General". Kills "/", "\\", and traversal (".." collapses
// to nothing → fallback) before they reach a write path.
export function sanitizeSegment(raw) {
  return rawSlug(raw).slice(0, 60) || "General";
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

// Single source of truth for note filenames so notePath and renderIndex can
// never drift. `${content-slug(40)}-${sanitized-id(12)}.md`: the id suffix
// pins identity, but the content prefix means an EDITED memory lands in a
// NEW file and the old note orphans (one-way v1 does not propagate renames
// or deletes; re-runs are otherwise idempotent).
export function noteFilename(memory) {
  return `${slugify(memory.content).slice(0, 40)}-${sanitizeSegment(String(memory.id)).slice(0, 12)}.md`;
}

export function notePath(memory) {
  // {category}/{person-or-General}/{filename}.md — relative to the vault
  // mirror root. Both segments sanitized (a "/" in a tag must not nest a
  // folder; ".." must not escape the mirror root).
  return [sanitizeSegment(String(memory.category || "note")), sanitizeSegment(personOf(memory)), noteFilename(memory)].join("/");
}

export function renderIndex(category, memories) {
  const lines = [
    `# Consuela Memory — ${category}`,
    "",
    `Auto-mirrored from the Consuela dashboard. ${memories.length} memor${memories.length === 1 ? "y" : "ies"}.`,
    "",
    ...memories.map((m) => `- [[${noteFilename(m)}]] — ${m.content.slice(0, 80)}`),
    "",
  ];
  return lines.join("\n");
}
