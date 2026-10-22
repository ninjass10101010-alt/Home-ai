/**
 * The memory block that rides every chat turn.
 *
 * Three zones, always in this order:
 *   1. Family facts   — the curated, always-current core (safety facts first)
 *   2. Playbooks      — a one-line index; the body loads on demand
 *   3. Relevant       — what the current message actually matched
 *
 * The kid variant replaces zone 1 with that child's own facts and drops
 * zones 2 and 3 — a child never sees a sibling's fact or a household secret.
 */

import { listActiveFacts, queryMemories } from "@/lib/family-memory";
import { selectCoreFacts } from "@/lib/memory-search";
import { listActivePlaybooks } from "@/lib/memory-playbooks";

export interface MemoryContextInput {
  role: "parent" | "child" | "guest";
  speakerName: string;
  message: string;
}

export interface FactView {
  id: string;
  category: string;
  content: string;
  person?: string;
  key?: string;
}

export interface PlaybookView {
  slug: string;
  title: string;
  trigger?: string;
}

export const FAMILY_FACT_BUDGET = 3000;
export const KID_FACT_BUDGET = 1200;
export const MAX_RELEVANT_FACTS = 8;

function factView(row: any): FactView {
  return {
    id: String(row.id),
    category: String(row.category ?? "note"),
    content: String(row.content ?? ""),
    person: String(row.person ?? ""),
    key: String(row.key ?? ""),
  };
}

/** Only the facts about this person. A first name matches a full name; a
 *  household fact (no person) never matches a kid. */
export function factsForSpeaker(facts: FactView[], speakerName: string): FactView[] {
  const wanted = String(speakerName ?? "").trim().toLowerCase();
  if (!wanted) return [];
  return facts.filter((f) => {
    const person = String(f.person ?? "").trim().toLowerCase();
    if (!person) return false;
    return person === wanted || person.includes(wanted) || wanted.includes(person);
  });
}

export function composeMemoryPrompt(input: {
  coreFacts: FactView[];
  playbooks: PlaybookView[];
  relevant: FactView[];
}): string {
  const lines: string[] = [];
  if (input.coreFacts.length) {
    lines.push("## Family facts (curated — always current)");
    for (const f of input.coreFacts) {
      const who = f.person ? `${f.person} — ` : "";
      lines.push(`- ${who}${f.category}: ${f.content}`);
    }
  }
  if (input.playbooks.length) {
    lines.push("## Playbooks");
    for (const p of input.playbooks) {
      lines.push(`- ${p.slug} — ${p.title}${p.trigger ? ` (when: ${p.trigger})` : ""}`);
    }
  }
  if (input.relevant.length) {
    lines.push("## Relevant to this message");
    for (const f of input.relevant) {
      const who = f.person ? ` (${f.person})` : "";
      lines.push(`- [${f.key ?? f.category}] ${f.content}${who}`);
    }
  }
  if (!lines.length) return "";
  return `\n${lines.join("\n")}\n`;
}

export async function buildMemoryContextBlock(input: MemoryContextInput): Promise<string> {
  try {
    if (input.role === "guest") return "";
    const rows = await listActiveFacts("demo-family");
    const all = rows.map(factView);
    const isKid = input.role === "child";

    const core = isKid
      ? selectCoreFacts(factsForSpeaker(all, input.speakerName) as any, { budget: KID_FACT_BUDGET, speakerName: input.speakerName })
      : selectCoreFacts(all as any, { budget: FAMILY_FACT_BUDGET, speakerName: input.speakerName });

    const relevant = isKid
      ? []
      : (await queryMemories({
          userId: "consuela",
          familyId: "demo-family",
          search: input.message,
          limit: MAX_RELEVANT_FACTS,
        })).map(factView);

    const playbooks = isKid
      ? []
      : (await listActivePlaybooks()).map((p) => ({ slug: p.slug, title: p.title, trigger: p.trigger }));

    return composeMemoryPrompt({
      coreFacts: core.map(factView),
      playbooks,
      relevant,
    });
  } catch {
    // A dead memory store must never break a chat turn.
    return "";
  }
}
