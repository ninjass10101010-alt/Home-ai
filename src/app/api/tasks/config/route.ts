import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { withKeyedLock } from "@/lib/keyed-lock";
import { textEmoji } from "@/lib/consuela/live-reads";
import { verifyLiveParentSession } from "@/lib/live-member";
import {
  parseTaskConfigCommand,
  sanitizeTaskConfigItems,
  type TaskConfigItem,
  type TaskConfigKind,
  type TaskConfigResponse,
  type TaskConfigStaleResponse,
} from "@/lib/task-config";
import {
  mutateSnapshotConfig,
  clearTaskConfigRepairMarker,
  InvalidStoredTaskConfigError,
  InvalidResultingTaskConfigError,
  type AdminPB,
} from "@/lib/snapshot-tasks";

export const dynamic = "force-dynamic";

type ConfigRouteOutcome =
  | { response: TaskConfigResponse }
  | { stale: TaskConfigStaleResponse }
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

export async function POST(request: NextRequest) {
  const auth = await verifyLiveParentSession(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_config_command" }, { status: 400 });
  }

  const command = parseTaskConfigCommand(body, textEmoji);
  if ("error" in command) {
    if (command.error === "config_natural_key_conflict" || command.error === "invalid_resulting_config") {
      return NextResponse.json({
        success: false,
        error: command.error,
        kind: command.kind,
      }, { status: command.error === "config_natural_key_conflict" ? 409 : 422 });
    }
    return NextResponse.json({ error: command.error }, { status: 400 });
  }

  try {
    const outcome = await withAdmin(async (pb): Promise<ConfigRouteOutcome> =>
      withKeyedLock(`task-config:${command.kind}`, async () => {
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
        const bodyResponse: TaskConfigResponse = {
          success: true,
          operationId: command.operationId,
          kind: command.kind,
          items: mutation.items,
          updatedAt: mutation.updatedAt,
          revision: responseRevision,
          applied: mutation.applied,
          stale: false,
        };
        return { response: bodyResponse };
      })
    );
    if ("conflict" in outcome) {
      return NextResponse.json({
        success: false,
        error: "operation_conflict",
        operationId: outcome.operationId,
      }, { status: 409 });
    }
    if ("stale" in outcome) {
      return NextResponse.json(outcome.stale, { status: 409 });
    }
    return NextResponse.json(outcome.response);
  } catch (error) {
    if (error instanceof InvalidStoredTaskConfigError) {
      return NextResponse.json({
        success: false,
        error: "invalid_current_config",
        kind: error.kind,
      }, { status: 422 });
    }
    if (error instanceof InvalidResultingTaskConfigError) {
      return NextResponse.json({
        success: false,
        error: "invalid_resulting_config",
        kind: error.kind,
      }, { status: 422 });
    }
    return NextResponse.json({ error: "config_store_unreachable" }, { status: 502 });
  }
}
