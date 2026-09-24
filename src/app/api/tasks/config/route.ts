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
} from "@/lib/task-config";
import {
  mutateSnapshotConfig,
  type AdminPB,
} from "@/lib/snapshot-tasks";

export const dynamic = "force-dynamic";

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
  const existing = await collection.getFullList({ requestKey: null }) as Record<string, unknown>[];
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
    return NextResponse.json({ error: command.error }, { status: 400 });
  }

  try {
    const response = await withAdmin(async (pb) =>
      withKeyedLock(`task-config:${command.kind}`, async () => {
        const mutation = await mutateSnapshotConfig(command, pb);
        const items = sanitizeTaskConfigItems(command.kind, mutation.items, textEmoji);
        if (!items) throw new TypeError("invalid_stored_config");
        if (!mutation.stale) {
          await reconcileConfigCollection(pb, command.kind, items);
        }
        const bodyResponse: TaskConfigResponse = {
          success: true,
          operationId: command.operationId,
          kind: command.kind,
          items,
          updatedAt: mutation.updatedAt,
          revision: mutation.revision,
          applied: mutation.applied,
        };
        return bodyResponse;
      })
    );
    return NextResponse.json(response);
  } catch {
    return NextResponse.json({ error: "config_store_unreachable" }, { status: 502 });
  }
}
