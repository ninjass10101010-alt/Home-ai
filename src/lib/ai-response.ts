export interface AiAction {
  type: string;
  title?: string;
  detail?: string;
  emoji?: string;
  meals?: any[];
  name?: string;
  ingredients?: any[];
  tags?: any[];
  [k: string]: any;
}

type ActionKey = "actions" | "action" | "meal_plan" | "meals";

const ACTION_KEYS: ActionKey[] = ["actions", "action", "meal_plan", "meals"];

/** Parse the first balanced `{...}` object substring from arbitrary text. */
function extractFirstObject(content: string): string | null {
  const start = content.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return content.slice(start, i + 1);
    }
  }
  return null;
}

/** Parse the balanced `[...]` array that starts at `openIndex`. */
function extractBalancedArray(content: string, openIndex: number): string | null {
  if (content[openIndex] !== "[") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openIndex; i < content.length; i++) {
    const ch = content[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return content.slice(openIndex, i + 1);
    }
  }
  return null;
}

function tryParseObject(content: string): any | null {
  const trimmed = content.trim();
  try {
    const direct = JSON.parse(trimmed);
    if (direct && typeof direct === "object") return direct;
  } catch {
    // not a direct JSON object — fall through
  }
  const braced = extractFirstObject(content);
  if (braced) {
    try {
      const obj = JSON.parse(braced);
      if (obj && typeof obj === "object") return obj;
    } catch {
      // not parseable
    }
  }
  return null;
}

const ACTION_ARRAY_RE = /"(?:actions|action|meal_plan|meals)"\s*:\s*\[/g;

function extractActionArrayFromRegex(content: string): any[] | null {
  ACTION_ARRAY_RE.lastIndex = 0;
  const match = ACTION_ARRAY_RE.exec(content);
  if (!match) return null;
  const openIndex = content.indexOf("[", match.index);
  if (openIndex === -1) return null;
  const arrayStr = extractBalancedArray(content, openIndex);
  if (!arrayStr) return null;
  try {
    const arr = JSON.parse(arrayStr);
    if (Array.isArray(arr)) return arr;
  } catch {
    // not parseable
  }
  return null;
}

/**
 * Extract an action array from an AI `content` string.
 *
 * The chat backend never returns a top-level `actions` field (it returns
 * `{ content }`), so callers must parse the JSON out of `content`. This helper
 * is resilient to every shape the model has produced:
 *   - a JSON string that is the object directly
 *   - an object wrapped in surrounding prose
 *   - wrapped under `actions` / `meal_plan` / `meals`
 *   - a bare JSON array
 *   - an `actions`/`meal_plan` array embedded in prose (regex fallback)
 */
export function extractActions(content: string): AiAction[] {
  if (!content || typeof content !== "string") return [];

  const parsed = tryParseObject(content);
  if (Array.isArray(parsed)) return parsed as AiAction[];
  if (parsed && typeof parsed === "object") {
    for (const key of ACTION_KEYS) {
      const candidate = (parsed as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) return candidate as AiAction[];
    }
  }

  const fromRegex = extractActionArrayFromRegex(content);
  if (fromRegex) return fromRegex as AiAction[];

  return [];
}
