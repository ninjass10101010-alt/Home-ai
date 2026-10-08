import type { AdminPB } from "@/lib/snapshot-tasks";
import { withKeyedLock } from "@/lib/keyed-lock";
import { textEmoji } from "@/lib/consuela/live-reads";
import {
  parseTaskConfigCommand,
  sanitizeTaskConfigItems,
  type TaskConfigCommand,
  type TaskConfigItem,
  type TaskConfigKind,
  type TaskConfigResponse,
} from "@/lib/task-config";
import {
  mutateSnapshotConfig,
  clearTaskConfigRepairMarker,
  InvalidStoredTaskConfigError,
  InvalidResultingTaskConfigError,
} from "@/lib/snapshot-tasks";

/**
 * The config apply seam shared by the `/api/tasks/config` route and the
 * server-side command queue drain, so a replayed config command runs the
 * EXACT mutation the original intake attempted (snapshot mutation, PB
 * collection reconcile, repair-marker clear) instead of a drifting copy.
 */

export type ConfigApplyOutcome =
  | { response: TaskConfigResponse }
  | { stale: { success: false; error: "stale_config"; operationId: string; kind: TaskConfigKind; items: unknown[]; updatedAt: string; applied: false; stale: true } }
  | { conflict: true; operationId: string };

function configKey(kind: TaskConfigKind, item: TaskConfigItem): string {
  if (kind === "weekly-prizes") {
    return `rank:${(item as Extract<TaskConfigItem, { rank: 1 | 2 | 3 }>).rank}`;
  }
  return `name:${String((item as Extract<TaskConfigItem, { name: string }>).name).toLowerCase()}`;
}

function configPayload(kind: TaskConfigKind, item: TaskConfigItem): Record<string, unknown> {
  if (kind === "rewards") {
    const reward = item as Extract<TaskConfigItem, { name: string; emoji: string; cost: number }>;
    return { name: reward.name, emoji: reward.emoji, cost: reward.cost };
  }
  if (kind === "penalties") {
    const penalty = item as Extract<TaskConfigItem, { name: string; emoji: string; points: number }>;
    return { name: penalty.name, emoji: penalty.emoji, points: penalty.points };
  }
  const prize = item as Extract<TaskConfigItem, { rank: 1 | 2 | 3; emoji: string; text: string }>;
  return { rank: prize.rank, emoji: prize.emoji, text: prize.text };
}

function samePayload(row: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  return Object.entries(payload).every(([key, value]) => row[key] === value);
}

async function reconcileConfigCollection(
  pb: AdminPB,
  kind: TaskConfigKind,
  items: TaskConfigItem[],
): Promise<void> {
  const collectionName = kind === "weekly-prizes"
    ? "weekly_prizes"
    : kind === "penalties"
      ? "penalties"
      : "rewards";
  const collection = pb.collection(collectionName);
  const existingRows = await collection.getFullList({ requestKey: null }) as Record<string, unknown>[];
  const existing = existingRows.sort((left, right) => (
    configKey(kind, left as unknown as TaskConfigItem).localeCompare(
      configKey(kind, right as unknown as TaskConfigItem),
    ) || String(left.id).localeCompare(String(right.id))
  ));
  const incoming = new Map(items.map((item) => [configKey(kind, item), item]));
  const retained = new Set<string>();

  for (const row of existing) {
    const key = configKey(kind, row as unknown as TaskConfigItem);
    const item = incoming.get(key);
    if (!item || retained.has(key)) {
      await collection.delete(String(row.id), { requestKey: null });
      continue;
    }
    retained.add(key);
    const payload = configPayload(kind, item);
    if (!samePayload(row, payload)) {
      await collection.update(String(row.id), payload, { requestKey: null });
    }
  }

  for (const [key, item] of incoming) {
    if (retained.has(key)) continue;
    await collection.create(configPayload(kind, item), { requestKey: null });
  }
}

/** Re-parse a stored config command payload (queue replay) or accept a parsed one. */
export function parseStoredTaskConfigCommand(
  payload: Record<string, unknown>,
): { command: TaskConfigCommand } | { error: string } {
  const parsed = parseTaskConfigCommand(
    {
      operationId: payload.operationId,
      action: payload.action,
      kind: payload.kind,
      updatedAt: payload.updatedAt,
      ...(Array.isArray(payload.items) ? { items: payload.items } : {}),
      ...(payload.item !== undefined ? { item: payload.item } : {}),
      ...(payload.itemId !== undefined ? { itemId: payload.itemId } : {}),
    },
    textEmoji,
  );
  if ("error" in parsed) return { error: parsed.error };
  return { command: parsed };
}

/**
 * Apply one config command inside the PB admin + keyed-lock envelope. Throws
 * the same typed errors the route surfaces (`InvalidStoredTaskConfigError`,
 * `InvalidResultingTaskConfigError`) and plain errors on store failure, so both
 * callers classify identically.
 */
export async function applyTaskConfigCommand(
  pb: AdminPB,
  command: TaskConfigCommand,
): Promise<ConfigApplyOutcome> {
  return withKeyedLock(`task-config:${command.kind}`, async () => {
    const mutation = await mutateSnapshotConfig(
      command,
      pb,
      (kind, value) => sanitizeTaskConfigItems(kind, value, textEmoji),
    );
    if (mutation.conflict) {
      return { conflict: true, operationId: command.operationId };
    }
    let responseRevision = mutation.revision;
    if (mutation.reconcile) {
      // Templates live in the snapshot only — there is no PB collection to
      // reconcile, and an unknown kind would fall back to `rewards`.
      if (command.kind !== "task-templates") {
        await reconcileConfigCollection(pb, command.kind, mutation.items);
      }
      if (mutation.clearRepairMarker) {
        const clearedRevision = await clearTaskConfigRepairMarker(command.operationId, pb);
        if (clearedRevision) responseRevision = clearedRevision;
      }
    }
    if (mutation.stale) {
      // The command was refused as STALE rather than quietly accepted: the
      // stored catalog moved past this write, so the caller is handed the
      // authoritative items and a stable 409 it can surface honestly.
      return {
        stale: {
          success: false,
          error: "stale_config",
          operationId: command.operationId,
          kind: command.kind,
          items: mutation.items,
          updatedAt: mutation.updatedAt,
          applied: false,
          stale: true,
        },
      };
    }
    const response: TaskConfigResponse = {
      success: true,
      operationId: command.operationId,
      kind: command.kind,
      items: mutation.items,
      updatedAt: mutation.updatedAt,
      revision: responseRevision,
      applied: mutation.applied,
      stale: false,
    };
    return { response };
  });
}
