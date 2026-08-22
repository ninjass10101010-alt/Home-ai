import { getHAWebSocketClient } from "@/lib/ha/websocket-client";
import { withAdmin } from "@/lib/pb-auth";

const MIRROR_KEY = "grocery";

interface MirrorResult {
  ok: boolean;
  reason?: string;
  added: string[];
  removed: string[];
}

interface GroceryRow {
  name?: unknown;
  needed?: unknown;
}

function desiredNames(grocery: GroceryRow[]): string[] {
  return grocery
    .filter((g) => typeof g.name === "string" && g.needed !== false)
    .map((g) => String(g.name))
    .sort((a, b) => a.localeCompare(b));
}

async function findGroceryTodoEntity(todoName: string): Promise<string | null> {
  const entities = (await withAdmin(async (pb) =>
    pb.collection("ha_entities").getFullList()
  )) as Array<{ entity_id: string; friendly_name?: string }>;
  const match = entities.find(
    (e) => e.entity_id.startsWith("todo.") && e.friendly_name === todoName
  );
  return match ? match.entity_id : null;
}

/** One-way Consuela → HA grocery mirror.
 * Desired = unchecked PB grocery items (needed !== false). Diffed against the
 * names we previously pushed (ha_mirror_state key="grocery"); HA-side
 * completions are never touched — we only manage names we own. */
export async function syncGroceryMirror(): Promise<MirrorResult> {
  const todoName = process.env.HA_GROCERY_TODO_NAME || "Consuela Grocery";

  const { grocery, mirror } = (await withAdmin(async (pb) => {
    const rows = (await pb.collection("grocery_list_items").getFullList()) as GroceryRow[];
    let last: string[] | null = null;
    try {
      const row = await pb.collection("ha_mirror_state").getFirstListItem(`key="${MIRROR_KEY}"`);
      last = JSON.parse(String(row.names ?? "[]"));
      if (!Array.isArray(last)) last = [];
    } catch (err) {
      if ((err as { status?: number })?.status !== 404) throw err;
    }
    return { grocery: rows, mirror: last };
  })) as { grocery: GroceryRow[]; mirror: string[] | null };

  const listEntityId = await findGroceryTodoEntity(todoName);

  if (!listEntityId) {
    console.warn(`[ha-mirror] no todo list named "${todoName}" in Home Assistant — create it once in HA.`);
    return { ok: false, reason: "no_list", added: [], removed: [] };
  }

  const desired = desiredNames(grocery);
  const lastSet = new Set(mirror ?? []);
  const desiredSet = new Set(desired);

  const toAdd = desired.filter((n) => !lastSet.has(n));
  const toRemove = (mirror ?? []).filter((n) => !desiredSet.has(n));

  if (toAdd.length === 0 && toRemove.length === 0) {
    return { ok: true, added: [], removed: [] };
  }

  const client = getHAWebSocketClient();
  for (const name of toAdd) {
    await client.callService("todo", "add_item", { item: name, list: listEntityId });
  }
  for (const name of toRemove) {
    await client.callService("todo", "remove_item", { item: name, list: listEntityId });
  }

  await withAdmin(async (pb) => {
    const collection = pb.collection("ha_mirror_state");
    const payload = { key: MIRROR_KEY, names: JSON.stringify(desired) };
    try {
      const existing = await collection.getFirstListItem(`key="${MIRROR_KEY}"`);
      await collection.update(existing.id, payload);
    } catch (err) {
      if ((err as { status?: number })?.status === 404) {
        await collection.create(payload);
        return;
      }
      throw err;
    }
  });

  return { ok: true, added: toAdd, removed: toRemove };
}
