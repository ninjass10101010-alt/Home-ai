/**
 * Capture — turning what a parent SAID into a memory candidate.
 *
 * The rule the family agreed on: a high-signal statement (an explicit
 * allergy, an explicit "remember that") is stored straight away and shown
 * with an undo chip; anything ambiguous (a first-person preference, a rule
 * with no clear owner) is only PROPOSED and waits for a tap.
 *
 * Pure: no PocketBase, no LLM. The detector is the same on every device.
 */

import { subjectKey } from "./memory-subject";

export type CaptureKind = "fact" | "rule";

export interface CaptureCandidate {
  kind: CaptureKind;
  content: string;
  category?: string;
  person?: string;
  topic?: string;
  subject?: string;
  slug?: string;
  domain?: string;
  trigger?: string;
  confidence: "high" | "low";
  reason: string;
}

interface DomainRule {
  domain: string;
  trigger: string;
  slug: string;
  patterns: RegExp[];
}

const DOMAIN_RULES: DomainRule[] = [
  { domain: "meals", trigger: "add_meal", slug: "meals.add_meal", patterns: [/\bmeal(s)?\b/i, /\bdinner\b/i, /\blunch\b/i, /\bbreakfast\b/i, /\brecipe\b/i, /\bemoji\b/i] },
  { domain: "grocery", trigger: "add_grocery_item", slug: "grocery.add_item", patterns: [/\bgrocery\b/i, /\bshopping list\b/i, /\binstacart\b/i] },
  { domain: "tasks", trigger: "add_task", slug: "tasks.add_task", patterns: [/\bchore(s)?\b/i, /\btask(s)?\b/i, /\bpoints?\b/i, /\breward(s)?\b/i] },
  { domain: "calendar", trigger: "add_event", slug: "calendar.add_event", patterns: [/\bcalendar\b/i, /\bappointment(s)?\b/i, /\bevent(s)?\b/i] },
];

const RULE_OPENERS = /\b(?:always|from now on(?:,| on)?|never|don'?t ever|stop)\b/i;

function matchRoster(text: string, roster: string[]): string | null {
  const lower = text.toLowerCase();
  for (const name of roster) {
    const candidate = String(name ?? "").trim().toLowerCase();
    if (!candidate) continue;
    const first = candidate.split(/\s+/)[0];
    if (lower.includes(candidate) || (first.length > 2 && lower.includes(first))) return name;
  }
  return null;
}

/** The task domain a rule belongs to, or null. */
export function playbookSlugFor(content: string): { slug: string; domain: string; trigger: string } | null {
  for (const rule of DOMAIN_RULES) {
    if (rule.patterns.some((p) => p.test(content))) {
      return { slug: rule.slug, domain: rule.domain, trigger: rule.trigger };
    }
  }
  return null;
}

export function detectCaptures(message: string, roster: string[] = []): CaptureCandidate[] {
  const text = String(message ?? "").trim();
  if (!text) return [];
  const out: CaptureCandidate[] = [];

  // 1. "remember that X" / "remember: X"
  const remember = /^(?:please\s+)?remember(?:\s+that)?\s*[:,-]?\s*(.+)$/i.exec(text);
  if (remember) {
    const content = remember[1].trim().replace(/[.!?]+$/, "");
    const person = matchRoster(content, roster);
    out.push({
      kind: "fact",
      content,
      category: "note",
      person: person ?? undefined,
      subject: subjectKey({ category: "note", person: person ?? undefined, topic: content, content }),
      confidence: "high",
      reason: "explicit_remember",
    });
    return out;
  }

  // 2. "<Name> is allergic to <thing>"
  const allergy = /^(.+?)\s+(?:is|are)\s+allergic\s+to\s+(.+)$/i.exec(text);
  if (allergy) {
    const person = matchRoster(allergy[1], roster);
    const topic = allergy[2].trim().replace(/[.!?]+$/, "");
    if (person) {
      out.push({
        kind: "fact",
        content: `${person} is allergic to ${topic}`,
        category: "allergy",
        person,
        topic,
        subject: subjectKey({ category: "allergy", person, topic }),
        confidence: "high",
        reason: "explicit_allergy",
      });
      return out;
    }
  }

  // 3. "<Name> loves / likes / hates / doesn't like <thing>"
  const preference = /^(.+?)\s+(?:loves|likes|hates|does\s*n[o']t\s+like|is\s+not\s+fond\s+of)\s+(.+)$/i.exec(text);
  if (preference) {
    const person = matchRoster(preference[1], roster);
    const topic = preference[2].trim().replace(/[.!?]+$/, "");
    if (person) {
      out.push({
        kind: "fact",
        content: `${person} ${/loves|likes/i.test(preference[0]) ? "likes" : "dislikes"} ${topic}`,
        category: "preference",
        person,
        topic,
        subject: subjectKey({ category: "preference", person, topic }),
        confidence: "high",
        reason: "explicit_preference",
      });
      return out;
    }
  }

  // 4. A rule ("always …", "never …", "from now on …") — a PROCEDURE when it
  //    names a task, otherwise a plain note the family can still approve.
  if (RULE_OPENERS.test(text)) {
    const domain = playbookSlugFor(text);
    if (domain) {
      out.push({
        kind: "rule",
        content: text,
        category: "rule",
        slug: domain.slug,
        domain: domain.domain,
        trigger: domain.trigger,
        confidence: "high",
        reason: "task_rule",
      });
    } else {
      out.push({
        kind: "rule",
        content: text,
        category: "rule",
        subject: subjectKey({ category: "rule", content: text }),
        confidence: "low",
        reason: "rule_without_domain",
      });
    }
    return out;
  }

  // 5. A first-person preference — the owner is ambiguous, so it is only
  //    ever PROPOSED, never stored.
  const firstPerson = /^\s*(?:i|we)\s+(?:love|like|hate|prefer)\s+(.+)$/i.exec(text);
  if (firstPerson) {
    out.push({
      kind: "fact",
      content: text,
      category: "preference",
      subject: subjectKey({ category: "preference", content: text }),
      confidence: "low",
      reason: "first_person_preference",
    });
  }

  return out;
}
