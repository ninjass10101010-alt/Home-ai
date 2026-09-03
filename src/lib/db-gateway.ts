export const DB_GATEWAY_COLLECTIONS: ReadonlySet<string> = new Set([
  "grocery_list_items", "pantry_items", "meal_plan_entries", "meal_week_archive",
  "recipes", "events", "schedules", "tasks", "week_data", "week_archive",
  "rewards", "penalties", "family_goals", "hall_of_fame",
  "chat_messages", "morning_briefing", "proactive_suggestions", "consuela_state",
  "emergency_contacts",
]);

export function isGatewayCollection(collection: string): boolean {
  return DB_GATEWAY_COLLECTIONS.has(collection);
}

// MF-4 — PocketBase's filter grammar supports @collection joins (and
// @request.*). Forwarded verbatim into a superuser getFullList, any sessioned
// caller could use them as a boolean oracle against non-allowlisted data —
// e.g. ~5k requests to brute-force a member PIN via
// `@collection.members.pin="0202"`. Only plain field filters pass.
export function isSafeFilter(filter: string | null): boolean {
  return !filter || !(/@collection|@request/i.test(filter));
}

/** Strip anything that looks like internal/credential fields before writing
 * client-supplied rows, and cap list sizes. */
// Credential-key matcher — deliberately precise. The old /pin/i substring rule
// also stripped `pinned` (the grocery 📌 manual-override boolean) from every
// gateway grocery write, silently losing the pin state. Keys like
// pinned/isPinned/manualPinned describe a UI state, not a credential, so the
// carve-out preserves them while still stripping exact pin/pins, camelCase or
// separator-bounded pin compounds (pinCode, pinField, pin_code, member_pin),
// keys ending in pin (memberPin), and secret/password/token fields.
function isCredentialKey(key: string): boolean {
  return (
    /^(pin|pins)$/.test(key) ||
    /^pin[A-Z]/.test(key) ||
    /pincode/i.test(key) ||
    /pin$/i.test(key) ||
    /(?:^|[_-])pin(?:$|[_-])/.test(key) ||
    /secret|password|token/i.test(key)
  );
}

export function sanitizeClientRow(row: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...row };
  delete clean.id;
  delete clean.created;
  delete clean.updated;
  delete clean.collectionId;
  delete clean.collectionName;
  for (const k of Object.keys(clean)) {
    if (isCredentialKey(k)) delete clean[k];
  }
  return clean;
}

export const MAX_LIST_LIMIT = 500;
