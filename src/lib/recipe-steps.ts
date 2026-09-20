const LIST_MARKER = /^\s*(?:\d+[.)]\s*|[-•*]\s*)+/;

function splitSentences(text: string): string[] {
  const parts = text
    .replace(/([.!?])\s+/g, "$1\u0001")
    .split("\u0001")
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    // Rejoin fragments that don't start a new sentence (e.g. "tbsp. olive oil")
    // onto the previous one.
    if (out.length > 0 && !/^[A-Z0-9"“‘(]/.test(part)) {
      out[out.length - 1] += " " + part;
    } else {
      out.push(part);
    }
  }
  return out;
}

export function parseInstructionsToSteps(instructions: string): string[] {
  const raw = (instructions || "").trim();
  if (!raw) return [];
  const lines = raw
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  let steps = lines;
  if (steps.length === 1) {
    steps = splitSentences(steps[0]);
  }
  return steps
    .map((s) => s.replace(LIST_MARKER, "").trim())
    .filter(Boolean);
}
