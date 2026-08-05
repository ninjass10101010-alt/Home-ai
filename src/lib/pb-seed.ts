import { withAdmin } from "./pb-auth";

const COLLECTIONS = [
  {
    name: "members",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "color", type: "text" },
      { name: "role", type: "text" },
      { name: "avatarSize", type: "text" },
      { name: "glow", type: "bool" },
      { name: "pin", type: "text" },
      { name: "phone", type: "text" },
      { name: "email", type: "text" },
    ],
    indexes: [],
  },
  {
    name: "meal_plan_entries",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "time", type: "text" },
      { name: "mealType", type: "text" },
      { name: "prepTime", type: "text" },
      { name: "tags", type: "json" },
      { name: "ingredients", type: "json" },
      { name: "servings", type: "number" },
      { name: "calories", type: "number" },
      { name: "protein", type: "number" },
      { name: "carbs", type: "number" },
      { name: "fat", type: "number" },
      { name: "recipeId", type: "text" },
      { name: "recipeSnapshotAt", type: "text" },
      { name: "weekOf", type: "text" },
      { name: "date", type: "text" },
      { name: "instructions", type: "text" },
      { name: "image", type: "text" },
    ],
  },
  {
    name: "pantry_items",
    schema: [
      { name: "item", type: "text", required: true },
      { name: "status", type: "select", options: { values: ["plenty", "low", "out"] } },
      { name: "category", type: "text" },
      { name: "quantity", type: "number" },
      { name: "unit", type: "text" },
    ],
  },
  {
    name: "grocery_list_items",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "category", type: "text" },
      { name: "aisle", type: "text" },
      { name: "quantity", type: "text" },
      { name: "priority", type: "select", options: { values: ["low", "medium", "high"] } },
      { name: "needed", type: "bool" },
      { name: "manualOverride", type: "bool" },
      { name: "source", type: "text" },
      { name: "quantityValue", type: "number" },
      { name: "unit", type: "text" },
      { name: "pinned", type: "bool" },
    ],
  },
  {
    name: "events",
    schema: [
      { name: "title", type: "text", required: true },
      { name: "date", type: "text" },
      { name: "time", type: "text" },
      { name: "icon", type: "text" },
      { name: "color", type: "text" },
      { name: "member", type: "text" },
    ],
  },
  {
    name: "tasks",
    schema: [
      { name: "title", type: "text", required: true },
      { name: "assigned", type: "text" },
      { name: "due", type: "text" },
      { name: "points", type: "number" },
      { name: "status", type: "select", options: { values: ["pending", "done"] } },
    ],
  },
  {
    name: "emergency_contacts",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "phone", type: "text" },
      { name: "email", type: "text" },
      { name: "carrier", type: "text" },
      { name: "isPrimary", type: "bool" },
    ],
  },
  {
    name: "schedules",
    schema: [
      { name: "title", type: "text", required: true },
      { name: "time", type: "text" },
      { name: "days", type: "text" },
      { name: "type", type: "text" },
      { name: "icon", type: "text" },
      { name: "color", type: "text" },
      { name: "member", type: "text" },
    ],
  },
  {
    name: "auth_sessions",
    schema: [
      { name: "token", type: "text", required: true },
      { name: "memberName", type: "text", required: true },
      { name: "deviceName", type: "text" },
      { name: "ip", type: "text" },
      { name: "createdAt", type: "text" },
      { name: "lastActiveAt", type: "text" },
    ],
  },
  {
    name: "tasks",
    schema: [
      { name: "taskId", type: "number", required: true },
      { name: "title", type: "text", required: true },
      { name: "assignee", type: "text" },
      { name: "assigneeEmoji", type: "text" },
      { name: "due", type: "text" },
      { name: "points", type: "number" },
      { name: "recurring", type: "text" },
      { name: "category", type: "text" },
      { name: "priority", type: "text" },
      { name: "universal", type: "bool" },
      { name: "createdAt", type: "text" },
      { name: "status", type: "select", options: { values: ["pending", "done"] } },
      { name: "completedInWeek", type: "text" },
      { name: "completedAt", type: "text" },
    ],
  },
  {
    name: "week_data",
    schema: [
      { name: "weekStart", type: "text", required: true },
      { name: "taskStates", type: "json" },
      { name: "points", type: "json" },
      { name: "streak", type: "json" },
      { name: "lastActive", type: "json" },
      { name: "history", type: "json" },
    ],
  },
  {
    name: "week_archive",
    schema: [
      { name: "weekStart", type: "text", required: true },
      { name: "archivedAt", type: "text" },
      { name: "points", type: "json" },
      { name: "streak", type: "json" },
      { name: "history", type: "json" },
    ],
  },
  {
    name: "meal_week_archive",
    schema: [
      { name: "weekStart", type: "text", required: true },
      { name: "archivedAt", type: "text" },
      { name: "data", type: "json" },
    ],
  },
  {
    name: "proactive_suggestions",
    schema: [
      { name: "idempotencyHash", type: "text", required: true },
      { name: "kind", type: "select", options: { values: ["pantry_low","task_penalty_streak","calendar_conflict","stale_data","custom"] } },
      { name: "severity", type: "select", options: { values: ["info","warn","alert"] } },
      { name: "title", type: "text", required: true },
      { name: "body", type: "text" },
      { name: "emoji", type: "text" },
      { name: "actionLabel", type: "text" },
      { name: "actionPayload", type: "json" },
      { name: "status", type: "select", options: { values: ["pending","dismissed","actioned","snoozed"] } },
      { name: "snoozedUntil", type: "date" },
      { name: "scopeDate", type: "text", required: true },
      { name: "createdAt", type: "date" },
      { name: "expiresAt", type: "date" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_hash_unique ON proactive_suggestions (idempotencyHash)",
      "CREATE INDEX idx_status_scope ON proactive_suggestions (status, scopeDate)",
    ],
  },
  {
    name: "morning_briefing",
    schema: [
      { name: "scopeDate", type: "text", required: true },
      { name: "summary", type: "json" },
      { name: "generatedAt", type: "date" },
      { name: "acknowledged", type: "bool" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_scope_unique ON morning_briefing (scopeDate)",
    ],
  },
  {
    name: "chat_messages",
    schema: [
      { name: "userId", type: "text", required: true },
      { name: "role", type: "select", options: { values: ["user", "assistant", "system"] } },
      { name: "content", type: "text", required: true },
      { name: "source", type: "select", options: { values: ["telegram", "dashboard", "api"] } },
      { name: "threadId", type: "text", required: true },
      { name: "createdAt", type: "date" },
    ],
    indexes: [
      "CREATE INDEX idx_thread_created ON chat_messages (threadId, createdAt)",
    ],
  },
  {
    name: "consuela_state",
    schema: [
      { name: "key", type: "text", required: true },
      { name: "value", type: "json" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_key_unique ON consuela_state (key)",
    ],
  },
  {
    name: "rewards",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "cost", type: "number" },
    ],
  },
  {
    name: "penalties",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "points", type: "number" },
    ],
  },
  {
    name: "family_goals",
    schema: [
      { name: "title", type: "text" },
      { name: "emoji", type: "text" },
      { name: "targetPoints", type: "number" },
      { name: "reward", type: "text" },
      { name: "weekStart", type: "text" },
      { name: "active", type: "bool" },
    ],
  },
  {
    name: "hall_of_fame",
    schema: [
      { name: "member", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "weekStart", type: "text", required: true },
      { name: "points", type: "number" },
      { name: "rank", type: "number" },
    ],
  },
  {
    name: "recipes",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "prepTime", type: "text" },
      { name: "cookTime", type: "text" },
      { name: "tags", type: "json" },
      { name: "ingredients", type: "json" },
      { name: "instructions", type: "text" },
      { name: "servings", type: "number" },
      { name: "calories", type: "number" },
      { name: "protein", type: "number" },
      { name: "carbs", type: "number" },
      { name: "fat", type: "number" },
      { name: "source", type: "text" },
      { name: "difficulty", type: "text" },
      { name: "favorite", type: "bool" },
      { name: "rating", type: "number" },
      { name: "image", type: "text" },
    ],
  },
];

export async function seedCollections() {
  const result = await withAdmin(async (pb) => {
    const existing = (await pb.collections.getFullList()).map((c: any) => c.name);
    const created: string[] = [];

    for (const col of COLLECTIONS) {
      if (existing.includes(col.name)) {
        const live = (await pb.collections.getFullList()).find((c: any) => c.name === col.name);
        if (!live) {
          created.push(`${col.name} (already exists)`);
          continue;
        }
        const liveFieldNames = new Set((live.fields || []).map((f: any) => f.name));
        const missingFields = col.schema.filter((s: any) => !liveFieldNames.has(s.name));

        const liveIndexNames = new Set(
          (live.indexes || []).map((i: any) => {
            if (typeof i === "string") {
              const match = i.match(/INDEX\s+(\S+)\s+ON/i);
              return match ? match[1] : i;
            }
            return i.name;
          })
        );
        const missingIndexes = (col.indexes || []).filter((i: any) => {
          const name = typeof i === "string"
            ? ((i.match(/INDEX\s+(\S+)\s+ON/i) || [])[1] || i)
            : i.name;
          return !liveIndexNames.has(name);
        });

        if (missingFields.length || missingIndexes.length) {
          const parts: string[] = [];
          if (missingFields.length) {
            const mergedFields = [
              ...(live.fields || []),
              ...missingFields.map((s: any) => {
                const base: any = { name: s.name, type: s.type, required: s.required || false };
                if (s.type === "select" && s.options) {
                  base.values = s.options.values;
                  if (s.options.maxSelect) base.maxSelect = s.options.maxSelect;
                }
                if (s.type === "json") base.type = "json";
                return base;
              }),
            ];
            await pb.collections.update(live.id, { fields: mergedFields });
            parts.push(`+${missingFields.length} fields: ${missingFields.map((m: any) => m.name).join(", ")}`);
          }
          if (missingIndexes.length) {
            await pb.collections.update(live.id, { indexes: [...(live.indexes || []), ...missingIndexes] });
            parts.push(`+${missingIndexes.length} indexes: ${missingIndexes.map((i: any) => typeof i === "string" ? ((i.match(/INDEX\s+(\S+)\s+ON/i) || [])[1] || i) : i.name).join(", ")}`);
          }
          created.push(`${col.name} (patched ${parts.join(", ")})`);
        } else {
          created.push(`${col.name} (already exists)`);
        }
        continue;
      }
      await pb.collections.create({
        name: col.name,
        type: "base",
        fields: col.schema.map((s: any) => {
          const base: any = {
            name: s.name,
            type: s.type,
            required: s.required || false,
          };
          if (s.type === "select" && s.options) {
            base.values = s.options.values;
            if (s.options.maxSelect) base.maxSelect = s.options.maxSelect;
          }
          if (s.type === "json") base.type = "json";
          return base;
        }),
        indexes: col.indexes || [],
      });
      created.push(col.name);
    }

    return created;
  });

  console.log("PocketBase collections:", result.join(", "));
  return result;
}
