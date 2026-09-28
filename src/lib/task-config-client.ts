"use client";

import {
  listTaskOutbox,
  onTaskOutboxAcknowledged,
  pullTaskSnapshotDocument,
  subscribeTaskOutbox,
  type TaskOutboxEntry,
} from "@/lib/task-operation-outbox";
import { queueTaskCommandAndFlush } from "@/lib/task-command-queue";
import {
  loadPenalties,
  loadRewards,
  loadWeeklyPrizes,
  readPenaltiesStamp,
  readRewardsStamp,
  readWeeklyPrizesStamp,
} from "@/lib/task-utils";
import type {
  TaskConfigAction,
  TaskConfigCommand,
  TaskConfigItem,
  TaskConfigKind,
  TaskConfigResponse,
} from "@/lib/task-config";

const CONFIG_KINDS = [
  "rewards",
  "penalties",
  "weekly-prizes",
] as const satisfies readonly TaskConfigKind[];

const CONFIG_ACTIONS = [
  "replace",
  "upsert",
  "delete",
] as const satisfies readonly TaskConfigAction[];

interface ConfigLeg {
  kind: TaskConfigKind;
  items: string;
  stamp: string;
  readCache: () => TaskConfigItem[];
  readStamp: () => string;
}

const CONFIG_LEGS: Record<TaskConfigKind, ConfigLeg> = {
  rewards: {
    kind: "rewards",
    items: "rewards",
    stamp: "rewardsUpdatedAt",
    readCache: () => loadRewards<TaskConfigItem[]>([]),
    readStamp: readRewardsStamp,
  },
  penalties: {
    kind: "penalties",
    items: "penalties",
    stamp: "penaltiesUpdatedAt",
    readCache: () => loadPenalties<TaskConfigItem[]>([]),
    readStamp: readPenaltiesStamp,
  },
  "weekly-prizes": {
    kind: "weekly-prizes",
    items: "weeklyPrizes",
    stamp: "weeklyPrizesStamp",
    readCache: () => loadWeeklyPrizes() as unknown as TaskConfigItem[],
    readStamp: readWeeklyPrizesStamp,
  },
};

function legFor(kind: unknown): ConfigLeg {
  const leg = CONFIG_KINDS.includes(kind as TaskConfigKind)
    ? CONFIG_LEGS[kind as TaskConfigKind]
    : undefined;
  if (!leg) throw new Error(`unsupported_task_config_kind:${String(kind)}`);
  return leg;
}

function actionFor(action: unknown): TaskConfigAction {
  if (!CONFIG_ACTIONS.includes(action as TaskConfigAction)) {
    throw new Error(`unsupported_task_config_action:${String(action)}`);
  }
  return action as TaskConfigAction;
}

function stampFor(value: unknown): string {
  const epoch = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : new Date().toISOString();
}

function response(
  operationId: string,
  leg: ConfigLeg,
  items: TaskConfigItem[],
  updatedAt: string,
  revision: string,
): TaskConfigResponse {
  return {
    success: true,
    operationId,
    kind: leg.kind,
    items,
    updatedAt,
    revision: { revision, updatedAt },
    applied: true,
    stale: false,
  };
}

function cacheResponse(operationId: string, leg: ConfigLeg): TaskConfigResponse {
  const updatedAt = leg.readStamp();
  return response(operationId, leg, leg.readCache(), updatedAt, updatedAt);
}

function acknowledged(leg: ConfigLeg, entry: TaskOutboxEntry): Promise<TaskConfigResponse> {
  return new Promise<TaskConfigResponse>((resolve, reject) => {
    let settled = false;
    const unacknowledged = () => {
      queueMicrotask(() => {
        finish(() => reject(
          new Error(`task_config_command_unacknowledged:${entry.operationId}`),
        ));
      });
    };
    const stopAcknowledged = onTaskOutboxAcknowledged((event) => {
      if (event?.operationId !== entry.operationId) return;
      finish(() => resolve(cacheResponse(entry.operationId, leg)));
    });
    const stopOutbox = subscribeTaskOutbox(() => {
      const current = listTaskOutbox().find(
        (candidate) => candidate.operationId === entry.operationId,
      );
      if (current) {
        if (current.status === "failed") {
          finish(() => reject(
            new Error(`task_config_command_refused:${current.lastErrorReason ?? "unknown"}`),
          ));
        }
        return;
      }
      unacknowledged();
    });

    function finish(settle: () => void) {
      if (settled) return;
      settled = true;
      stopAcknowledged();
      stopOutbox();
      settle();
    }

    if (!listTaskOutbox().some((candidate) => candidate.operationId === entry.operationId)) {
      unacknowledged();
    }
  });
}

export async function readTaskConfig(kind: TaskConfigKind): Promise<TaskConfigResponse> {
  const leg = legFor(kind);
  const read = await pullTaskSnapshotDocument();
  const snapshot = read.snapshot as Record<string, unknown> | null;
  if (!snapshot) throw new Error("task_config_read_unavailable");
  const items = Array.isArray(snapshot[leg.items]) ? (snapshot[leg.items] as TaskConfigItem[]) : [];
  const snapshotStamp = snapshot[leg.stamp];
  const updatedAt = typeof snapshotStamp === "string" ? snapshotStamp : "";
  const snapshotRevision = snapshot.revision;
  const revision = typeof snapshotRevision === "string" ? snapshotRevision : updatedAt;
  return response("", leg, items, updatedAt, revision);
}

export async function writeTaskConfig(command: TaskConfigCommand): Promise<TaskConfigResponse> {
  const leg = legFor(command?.kind);
  const action = actionFor(command?.action);
  const updatedAt = stampFor(command?.updatedAt);
  const payload: Record<string, unknown> = { kind: leg.kind, updatedAt };
  if (action === "replace") {
    payload.items = Array.isArray(command.items) ? command.items : [];
  } else if (action === "upsert") {
    if (command.item === undefined) throw new Error("missing_task_config_item");
    payload.item = command.item;
  } else {
    if (command.itemId === undefined) throw new Error("missing_task_config_item_id");
    payload.itemId = command.itemId;
  }

  const entry = queueTaskCommandAndFlush({
    ...(typeof command?.operationId === "string" && command.operationId.trim()
      ? { operationId: command.operationId.trim() }
      : {}),
    route: "/api/tasks/config",
    action,
    payload,
    displayTarget: { kind: "config" },
  });

  return acknowledged(leg, entry);
}
