import { withAdmin } from "@/lib/pb-auth";

export interface HAEntityRecord {
  entity_id: string;
  domain: string;
  object_id: string;
  friendly_name: string;
  area_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_updated: string;
  source: "ha" | "mqtt";
}

const MAX_WARNED = 100;
const warnedMessages = new Set<string>();
let upsertLogCount = 0;

function warnOnce(message: string): void {
  if (warnedMessages.has(message)) return;
  if (warnedMessages.size >= MAX_WARNED) {
    const oldest = warnedMessages.values().next().value;
    if (oldest !== undefined) warnedMessages.delete(oldest);
  }
  warnedMessages.add(message);
  console.warn(message);
}

export async function upsertHAEntity(record: HAEntityRecord): Promise<void> {
  try {
    await withAdmin(async (pb) => {
      const collection = pb.collection("ha_entities");
      try {
        const existing = await collection.getFirstListItem(`entity_id="${record.entity_id}"`);
        await collection.update(existing.id, record);
      } catch (err) {
        if ((err as { status?: number })?.status === 404) {
          try {
            await collection.create(record);
          } catch (createErr) {
            // Lost a create race against the unique index — recover by
            // updating whichever concurrent write won instead of dropping
            // this state change on the floor.
            const winner = await collection.getFirstListItem(
              `entity_id="${record.entity_id}"`
            );
            await collection.update(winner.id, record);
          }
          return;
        }
        throw err;
      }
    });
    if (upsertLogCount < 5) {
      upsertLogCount += 1;
      console.log("[ha] upsert", record.entity_id, record.state);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnOnce(`[ha] upsert failed for ${record.entity_id}: ${message}`);
  }
}

/** Home Assistant emits state_changed with new_state === null when an entity
 * is removed. Drop our cached row so deleted devices don't linger as ghosts. */
export async function deleteHAEntity(entityId: string): Promise<void> {
  try {
    await withAdmin(async (pb) => {
      const collection = pb.collection("ha_entities");
      try {
        const existing = await collection.getFirstListItem(`entity_id="${entityId}"`);
        await collection.delete(existing.id);
      } catch (err) {
        if ((err as { status?: number })?.status === 404) return;
        throw err;
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnOnce(`[ha] delete failed for ${entityId}: ${message}`);
  }
}

export async function upsertHAEntities(records: HAEntityRecord[]): Promise<void> {
  for (const record of records) {
    await upsertHAEntity(record);
  }
}
