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
    indexes: [
      "CREATE UNIQUE INDEX idx_consuela_google_calendar_events_google_id ON consuela_google_calendar_events (google_id)",
    ],
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
    return created;
  });
}
