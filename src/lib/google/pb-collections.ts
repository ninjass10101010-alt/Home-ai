import { withAdmin } from "../pb-auth.ts";

interface ColField {
  name: string;
  type: "text" | "date" | "bool" | "number" | "select" | "json" | "email" | "url";
  required?: boolean;
  options?: Record<string, any>;
}

interface ColSpec {
  name: string;
  fields: ColField[];
  indexes?: string[];
}

const TEXT_DEFAULTS = { max: 100000, min: 0, pattern: "" };

// Multi-calendar sync (Fix-C): the events table is keyed by (calendar_id,
// google_id) — the same Google event id can legitimately appear in more than
// one calendar, so the old single-column unique index on google_id is wrong.
// EVENTS_COMPOSITE_INDEX is the desired end state; LEGACY_EVENTS_INDEX is the
// pre-fix index that the self-heal drops.
const EVENTS_COLLECTION_NAME = "consuela_google_calendar_events";
export const EVENTS_COMPOSITE_INDEX =
  "CREATE UNIQUE INDEX idx_consuela_google_calendar_events_calendar_google ON consuela_google_calendar_events (calendar_id, google_id)";
export const LEGACY_EVENTS_INDEX_NAME = "idx_consuela_google_calendar_events_google_id";

function fieldFor(f: ColField) {
  if (f.type === "text") {
    return {
      name: f.name,
      type: "text",
      required: !!f.required,
      options: { ...TEXT_DEFAULTS, ...(f.options || {}) },
    };
  }
  if (f.type === "select") {
    // PB v0.27 select validation is broken in this build (rejects all select fields
    // with "fields.1.values cannot be blank" even when values is provided).
    // Map to text and validate enum membership in the application layer instead.
    return {
      name: f.name,
      type: "text",
      required: !!f.required,
      options: { ...TEXT_DEFAULTS, ...(f.options || {}) },
    };
  }
  if (f.type === "json") {
    return {
      name: f.name,
      type: "json",
      required: !!f.required,
      options: { maxSize: 1000000 },
    };
  }
  if (f.type === "date") {
    return { name: f.name, type: "date", required: !!f.required, options: { min: "", max: "" } };
  }
  if (f.type === "bool") {
    return { name: f.name, type: "bool", required: !!f.required };
  }
  if (f.type === "number") {
    return {
      name: f.name,
      type: "number",
      required: !!f.required,
      options: { min: null, max: null, noDecimal: false },
    };
  }
  return { name: f.name, type: f.type, required: !!f.required };
}

const COLLECTIONS: ColSpec[] = [
  {
    name: "consuela_google_tokens",
    fields: [
      { name: "access_token", type: "text" },
      { name: "refresh_token", type: "text" },
      { name: "scope", type: "text" },
      { name: "token_type", type: "text" },
      { name: "expires_at", type: "date" },
      { name: "account_email", type: "text" },
      { name: "granted_at", type: "date" },
      { name: "revoked_at", type: "date" },
    ],
  },
  {
    name: "consuela_google_calendar_events",
    fields: [
      { name: "google_id", type: "text", required: true },
      { name: "calendar_id", type: "text" },
      { name: "summary", type: "text" },
      { name: "description", type: "text" },
      { name: "location", type: "text" },
      { name: "start_iso", type: "text" },
      { name: "end_iso", type: "text" },
      { name: "all_day", type: "bool" },
      { name: "etag", type: "text" },
      { name: "html_link", type: "text" },
      { name: "updated_remote", type: "text" },
      { name: "source", type: "text" },
      { name: "raw", type: "json" },
      { name: "next_sync_token", type: "text" },
    ],
    indexes: [EVENTS_COMPOSITE_INDEX],
  },
  {
    name: "consuela_google_tasks",
    fields: [
      { name: "google_id", type: "text", required: true },
      { name: "tasklist_id", type: "text" },
      { name: "title", type: "text" },
      { name: "notes", type: "text" },
      { name: "due", type: "text" },
      { name: "status", type: "select", options: { values: ["needsAction", "completed"], maxSelect: 1 } },
      { name: "completed", type: "text" },
      { name: "kind", type: "select", options: { values: ["chore", "reminder"], maxSelect: 1 } },
      { name: "etag", type: "text" },
      { name: "updated_remote", type: "text" },
      { name: "raw", type: "json" },
      { name: "source", type: "text" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_consuela_google_tasks_google_id ON consuela_google_tasks (google_id)",
    ],
  },
  {
    name: "consuela_google_tasklists",
    fields: [
      { name: "google_id", type: "text", required: true },
      { name: "title", type: "text" },
      { name: "owned_by_dashboard", type: "bool" },
      { name: "updated_remote", type: "text" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_consuela_google_tasklists_google_id ON consuela_google_tasklists (google_id)",
    ],
  },
  {
    name: "consuela_google_sync_state",
    fields: [
      { name: "resource", type: "text", required: true },
      { name: "sync_token", type: "text" },
      { name: "last_sync_at", type: "date" },
      { name: "last_status", type: "text" },
      { name: "last_error", type: "text" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_consuela_google_sync_state_resource ON consuela_google_sync_state (resource)",
    ],
  },
  {
    // Per-calendar sync state + selection for multi-calendar Google Calendar
    // sync. One row per Google calendar id: which ones the family opted into
    // (selected), their display color, and each calendar's own incremental
    // sync token / last-run outcome. Replaces the single resource="calendar"
    // row in consuela_google_sync_state (migrated on first run below).
    name: "consuela_google_calendar_sync",
    fields: [
      { name: "calendar_id", type: "text", required: true },
      { name: "summary", type: "text" },
      { name: "color_rgb", type: "text" },
      { name: "selected", type: "bool" },
      { name: "sync_token", type: "text" },
      { name: "last_sync_at", type: "date" },
      { name: "last_status", type: "text" },
      { name: "last_error", type: "text" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_consuela_google_calendar_sync_calendar_id ON consuela_google_calendar_sync (calendar_id)",
    ],
  },
  {
    name: "consuela_google_api_usage",
    fields: [
      { name: "date", type: "text", required: true },
      { name: "count", type: "number" },
      { name: "last_endpoint", type: "text" },
      { name: "last_reset_at", type: "date" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_consuela_google_api_usage_date ON consuela_google_api_usage (date)",
    ],
  },
  {
    name: "consuela_data_snapshots",
    fields: [
      { name: "key", type: "text", required: true },
      { name: "data", type: "json" },
      { name: "updated_at", type: "date" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_consuela_data_snapshots_key ON consuela_data_snapshots (key)",
    ],
  },
];

export async function ensureGoogleCollections(): Promise<string[]> {
  return withAdmin(async (pb) => {
    const all = await pb.collections.getFullList();
    const existing = new Map<string, any>(all.map((c: any) => [c.name, c]));
    const created: string[] = [];

    for (const col of COLLECTIONS) {
      const live = existing.get(col.name);
      const desiredFields = col.fields.map(fieldFor);

      if (!live) {
        await pb.collections.create({
          name: col.name,
          type: "base",
          fields: desiredFields,
          indexes: col.indexes || [],
        });
        created.push(`${col.name} (created)`);
        continue;
      }

      const liveFieldNames = new Set((live.fields || []).map((f: any) => f.name));
      const missing = col.fields.filter((f) => !liveFieldNames.has(f.name));
      if (missing.length) {
        const merged = [
          ...(live.fields || []),
          ...missing.map(fieldFor),
        ];
        await pb.collections.update(live.id, { fields: merged });
        created.push(`${col.name} (patched +${missing.length} fields: ${missing.map((m) => m.name).join(", ")})`);
      } else {
        created.push(`${col.name} (ok)`);
      }
    }

    created.push(await migrateCalendarSelection(pb));
    // A freshly-created events collection already carries the composite index
    // from the spec above; the heal only matters for pre-existing tables.
    const liveEvents = existing.get(EVENTS_COLLECTION_NAME);
    if (liveEvents) {
      created.push(await healEventsIndex(pb, liveEvents));
    }
    return created;
  });
}

// One-time migration: the pre-multi-calendar world kept a single sync token in
// consuela_google_sync_state (resource="calendar"). Copy it onto the primary
// calendar's row in consuela_google_calendar_sync so the first multi-calendar
// sync stays incremental instead of paying a full re-pull. Runs only while the
// new collection has no rows (idempotent; syncCalendar's primary-default keeps
// the old single-calendar behavior even before this row exists).
async function migrateCalendarSelection(pb: any): Promise<string> {
  try {
    const rows = await pb
      .collection("consuela_google_calendar_sync")
      .getFullList({ requestKey: null });
    if (rows.length > 0) return "consuela_google_calendar_sync (selection ok)";

    let legacyToken: string | null = null;
    try {
      const legacy = await pb
        .collection("consuela_google_sync_state")
        .getFullList({ requestKey: null, filter: `resource = "calendar"` });
      legacyToken = legacy[0]?.sync_token || null;
    } catch {
      // legacy row/collection missing — nothing to carry over
    }
    await pb
      .collection("consuela_google_calendar_sync")
      .create(
        {
          calendar_id: "primary",
          summary: "Primary",
          selected: true,
          sync_token: legacyToken,
        },
        { requestKey: null },
      );
    return `consuela_google_calendar_sync (migrated primary selection${legacyToken ? " + token" : ""})`;
  } catch (e: any) {
    return `consuela_google_calendar_sync (migration skipped: ${e?.message || e})`;
  }
}

// Index self-heal for consuela_google_calendar_events: swap the legacy
// UNIQUE(google_id) index for UNIQUE(calendar_id, google_id). Creating the
// unique index on a table that still holds duplicates fails, so the heal
// first normalizes empty calendar_id (Composio-populated rows belong to the
// primary calendar) and dedupes any (calendar_id, google_id) collisions,
// then rewrites the collection's index list. Runs only while the composite
// index is missing — steady-state calls are a cheap metadata check.
async function healEventsIndex(pb: any, live: any): Promise<string> {
  try {
    const liveIndexes: string[] = live.indexes || [];
    const hasComposite = liveIndexes.some((s) =>
      /UNIQUE\s+INDEX.*\(\s*calendar_id,\s*google_id\s*\)/i.test(s),
    );
    if (hasComposite) return `${EVENTS_COLLECTION_NAME} (index ok)`;

    const events = pb.collection(EVENTS_COLLECTION_NAME);
    const rows = await events.getFullList({ requestKey: null, sort: "id" });

    // 1. Normalize: empty/missing calendar_id means the primary calendar.
    let normalized = 0;
    for (const row of rows) {
      if (!row.calendar_id) {
        await events.update(row.id, { calendar_id: "primary" }, { requestKey: null });
        row.calendar_id = "primary";
        normalized++;
      }
    }

    // 2. Dedupe (calendar_id, google_id) collisions — keep the first row.
    const seen = new Set<string>();
    let deduped = 0;
    for (const row of rows) {
      const key = `${row.calendar_id}\u0000${row.google_id}`;
      if (seen.has(key)) {
        await events.delete(row.id, { requestKey: null });
        deduped++;
      } else {
        seen.add(key);
      }
    }

    // 3. Drop the legacy single-column unique index, add the composite one.
    const nextIndexes = liveIndexes
      .filter((s) => !new RegExp(`\\b${LEGACY_EVENTS_INDEX_NAME}\\b`).test(s))
      .concat([EVENTS_COMPOSITE_INDEX]);
    await pb.collections.update(live.id, { indexes: nextIndexes }, { requestKey: null });

    return `${EVENTS_COLLECTION_NAME} (index healed: +composite unique, -legacy, normalized ${normalized}, deduped ${deduped})`;
  } catch (e: any) {
    return `${EVENTS_COLLECTION_NAME} (index heal failed: ${e?.message || e})`;
  }
}
