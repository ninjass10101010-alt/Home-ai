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
        const liveFieldNames = new Set((live.schema || []).map((f: any) => f.name));
        const missing = col.schema.filter((s: any) => !liveFieldNames.has(s.name));
        if (missing.length) {
          const mergedSchema = [
            ...(live.schema || []),
            ...missing.map((s: any) => {
              const base: any = { name: s.name, type: s.type, required: s.required || false };
              if (s.type === "select" && s.options) base.options = s.options;
              if (s.type === "json") base.type = "json";
              return base;
            }),
          ];
          await pb.collections.update(live.id, { schema: mergedSchema });
          created.push(`${col.name} (patched +${missing.length} fields: ${missing.map((m: any) => m.name).join(", ")})`);
        } else {
          created.push(`${col.name} (already exists)`);
        }
        continue;
      }
      await pb.collections.create({
        name: col.name,
        type: "base",
        schema: col.schema.map((s: any) => {
          const base: any = {
            name: s.name,
            type: s.type,
            required: s.required || false,
          };
          if (s.type === "select" && s.options) base.options = s.options;
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
