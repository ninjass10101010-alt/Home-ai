import { createHash } from "node:crypto";
import {
  isRecord,
  normalizeOperationId,
  normalizeTimestamp,
} from "@/lib/task-operation-contract";
import type { SnapshotRevision } from "@/lib/snapshot-tasks";

export type TaskConfigKind = "rewards" | "penalties" | "weekly-prizes";
export type TaskConfigAction = "replace" | "upsert" | "delete";

export interface RewardConfigItem {
  id?: string | number;
  name: string;
  emoji: string;
  cost: number;
  category?: string;
}

export interface PenaltyConfigItem {
  id?: string | number;
  name: string;
  emoji: string;
  points: number;
}

export interface WeeklyPrizeConfigItem {
  id?: string;
  rank: 1 | 2 | 3;
  emoji: string;
  text: string;
}

export type TaskConfigItem =
  | RewardConfigItem
  | PenaltyConfigItem
  | WeeklyPrizeConfigItem;

export interface TaskConfigCommand {
  operationId: string;
  kind: TaskConfigKind;
  action: TaskConfigAction;
  updatedAt: string;
  items?: TaskConfigItem[];
  item?: TaskConfigItem;
  itemId?: string | number;
}

export interface TaskConfigResponse {
  success: true;
  operationId: string;
  kind: TaskConfigKind;
  items: TaskConfigItem[];
  updatedAt: string;
  revision: SnapshotRevision;
  applied: boolean;
}

export type TaskConfigParseResult =
  | TaskConfigCommand
  | { error: "forbidden_config_field" | "invalid_config_command" };

export const TASK_CONFIG_KINDS = ["rewards", "penalties", "weekly-prizes"] as const;
export const TASK_CONFIG_ACTIONS = ["replace", "upsert", "delete"] as const;
export const TASK_CONFIG_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export const TASK_CONFIG_DATA_KEYS: Record<TaskConfigKind, string> = {
  rewards: "rewards",
  penalties: "penalties",
  "weekly-prizes": "weeklyPrizes",
};

export const TASK_CONFIG_STAMP_KEYS: Record<TaskConfigKind, string> = {
  rewards: "rewardsUpdatedAt",
  penalties: "penaltiesUpdatedAt",
  "weekly-prizes": "weeklyPrizesStamp",
};

const TOP_LEVEL_KEYS = new Set([
  "operationId",
  "kind",
  "action",
  "updatedAt",
  "items",
  "item",
  "itemId",
]);
const REWARD_KEYS = new Set(["id", "name", "emoji", "cost", "category"]);
const PENALTY_KEYS = new Set(["id", "name", "emoji", "points"]);
const WEEKLY_PRIZE_KEYS = new Set(["id", "rank", "emoji", "text"]);
const MAX_TEXT_LENGTH = 5000;
const MAX_ID_LENGTH = 200;
const MAX_POINTS = 1_000_000_000;

export const TASK_CONFIG_RECEIPT_MAX_COUNT = 256;
export const TASK_CONFIG_RECEIPT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type TaskConfigEmojiBoundary = (value: string) => string;

function canonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function taskConfigCommandFingerprint(command: TaskConfigCommand): string {
  const payload = {
    kind: command.kind,
    action: command.action,
    updatedAt: command.updatedAt,
    ...(command.items !== undefined ? { items: command.items } : {}),
    ...(command.item !== undefined ? { item: command.item } : {}),
    ...(command.itemId !== undefined ? { itemId: command.itemId } : {}),
  };
  return createHash("sha256").update(canonicalValue(payload)).digest("hex");
}

function invalid(): TaskConfigParseResult {
  return { error: "invalid_config_command" };
}

function forbidden(): TaskConfigParseResult {
  return { error: "forbidden_config_field" };
}

function normalizeText(value: unknown, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > MAX_TEXT_LENGTH) return null;
  return text;
}

function normalizeEmoji(
  value: unknown,
  boundary: TaskConfigEmojiBoundary,
): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const emoji = boundary(text).trim();
  if (!emoji || emoji.length > MAX_TEXT_LENGTH || /^(data:|https?:\/\/|\/\/)/i.test(emoji)) {
    return null;
  }
  return emoji;
}

function normalizeOptionalId(value: unknown, weekly = false): string | number | undefined | null {
  if (value === undefined) return undefined;
  if (weekly) {
    if (typeof value !== "string") return null;
    const id = value.trim();
    return id && id.length <= MAX_ID_LENGTH ? id : null;
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id && id.length <= MAX_ID_LENGTH ? id : null;
}

function normalizeAmount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_POINTS
    ? value
    : null;
}

function normalizeRank(value: unknown): 1 | 2 | 3 | null {
  return value === 1 || value === 2 || value === 3 ? value : null;
}

function parseItem(
  kind: TaskConfigKind,
  value: unknown,
  boundary: TaskConfigEmojiBoundary,
): TaskConfigItem | "forbidden" | null {
  if (!isRecord(value)) return null;
  const allowed = kind === "rewards"
    ? REWARD_KEYS
    : kind === "penalties"
      ? PENALTY_KEYS
      : WEEKLY_PRIZE_KEYS;
  if (Object.keys(value).some((key) => !allowed.has(key))) return "forbidden";

  const id = normalizeOptionalId(value.id, kind === "weekly-prizes");
  if (id === null) return null;
  const emoji = normalizeEmoji(value.emoji, boundary);
  if (!emoji) return null;

  if (kind === "rewards") {
    const name = normalizeText(value.name);
    const cost = normalizeAmount(value.cost);
    if (!name || cost === null) return null;
    const category = value.category === undefined
      ? undefined
      : normalizeText(value.category);
    if (value.category !== undefined && !category) return null;
    return {
      ...(id === undefined ? {} : { id }),
      name,
      emoji,
      cost,
      ...(category ? { category } : {}),
    };
  }

  if (kind === "penalties") {
    const name = normalizeText(value.name);
    const points = normalizeAmount(value.points);
    if (!name || points === null) return null;
    return {
      ...(id === undefined ? {} : { id }),
      name,
      emoji,
      points,
    };
  }

  const rank = normalizeRank(value.rank);
  const text = normalizeText(value.text, true);
  if (rank === null || text === null) return null;
  return {
    id: id === undefined ? `prize-${rank}` : String(id),
    rank,
    emoji,
    text,
  };
}

function itemKey(kind: TaskConfigKind, item: TaskConfigItem): string {
  if (kind === "weekly-prizes") return String((item as WeeklyPrizeConfigItem).rank);
  return String((item as RewardConfigItem | PenaltyConfigItem).name).toLowerCase();
}

function parseItems(
  kind: TaskConfigKind,
  value: unknown,
  boundary: TaskConfigEmojiBoundary,
): TaskConfigItem[] | "forbidden" | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const items: TaskConfigItem[] = [];
  const keys = new Set<string>();
  for (const candidate of value) {
    const item = parseItem(kind, candidate, boundary);
    if (item === "forbidden") return "forbidden";
    if (!item) return null;
    const key = itemKey(kind, item);
    if (keys.has(key)) return null;
    keys.add(key);
    items.push(item);
  }
  return items;
}

export function sanitizeTaskConfigItems(
  kind: TaskConfigKind,
  value: unknown,
  emojiBoundary: TaskConfigEmojiBoundary,
): TaskConfigItem[] | null {
  const items = parseItems(kind, value, emojiBoundary);
  return items === "forbidden" ? null : items;
}

export function parseTaskConfigCommand(
  value: unknown,
  emojiBoundary: TaskConfigEmojiBoundary,
  now = Date.now(),
): TaskConfigParseResult {
  if (!isRecord(value)) return invalid();
  if (Object.keys(value).some((key) => !TOP_LEVEL_KEYS.has(key))) return forbidden();

  const operationId = normalizeOperationId(value.operationId);
  const updatedAt = normalizeTimestamp(value.updatedAt);
  const kind = TASK_CONFIG_KINDS.includes(value.kind as TaskConfigKind)
    ? value.kind as TaskConfigKind
    : null;
  const action = TASK_CONFIG_ACTIONS.includes(value.action as TaskConfigAction)
    ? value.action as TaskConfigAction
    : null;
  if (
    !operationId ||
    operationId.length > MAX_ID_LENGTH ||
    !updatedAt ||
    Date.parse(updatedAt) > now + TASK_CONFIG_MAX_FUTURE_SKEW_MS ||
    !kind ||
    !action
  ) return invalid();

  if (value.item !== undefined && parseItem(kind, value.item, emojiBoundary) === "forbidden") {
    return forbidden();
  }
  if (value.items !== undefined && parseItems(kind, value.items, emojiBoundary) === "forbidden") {
    return forbidden();
  }

  if (action === "replace") {
    if (value.item !== undefined || value.itemId !== undefined) return invalid();
    const items = parseItems(kind, value.items, emojiBoundary);
    if (items === "forbidden") return forbidden();
    if (!items) return invalid();
    return { operationId, kind, action, updatedAt, items };
  }

  if (action === "upsert") {
    if (value.items !== undefined || value.itemId !== undefined) return invalid();
    const item = parseItem(kind, value.item, emojiBoundary);
    if (item === "forbidden") return forbidden();
    if (!item) return invalid();
    return { operationId, kind, action, updatedAt, item };
  }

  if (value.items !== undefined || value.item !== undefined) return invalid();
  const itemId = normalizeOptionalId(value.itemId);
  if (itemId === null || itemId === undefined) return invalid();
  return { operationId, kind, action, updatedAt, itemId };
}

function sameId(left: unknown, right: string | number): boolean {
  return left !== undefined && String(left) === String(right);
}

function compactWeeklyPrizes(items: TaskConfigItem[]): TaskConfigItem[] {
  return [...items]
    .sort((left, right) => (
      (left as WeeklyPrizeConfigItem).rank - (right as WeeklyPrizeConfigItem).rank
    ))
    .map((item, index) => ({
      ...(item as WeeklyPrizeConfigItem),
      rank: (index + 1) as 1 | 2 | 3,
    }));
}

export function applyTaskConfigCommand(
  currentValue: unknown,
  command: TaskConfigCommand,
): TaskConfigItem[] {
  const current = Array.isArray(currentValue)
    ? currentValue as TaskConfigItem[]
    : [];

  if (command.action === "replace") {
    return command.kind === "weekly-prizes"
      ? compactWeeklyPrizes(command.items ?? [])
      : [...(command.items ?? [])];
  }

  if (command.action === "upsert") {
    const incoming = command.item!;
    let index = -1;
    if (incoming.id !== undefined) {
      index = current.findIndex((item) => sameId(item.id, incoming.id!));
    }
    if (index < 0) {
      const key = itemKey(command.kind, incoming);
      index = current.findIndex((item) => itemKey(command.kind, item) === key);
    }
    const existing = index >= 0 ? current[index] : null;
    const item = {
      ...(existing ?? {}),
      ...incoming,
      ...(existing?.id !== undefined && incoming.id === undefined ? { id: existing.id } : {}),
    } as TaskConfigItem;
    const next = current.filter((_candidate, candidateIndex) => candidateIndex !== index);
    next.splice(index < 0 ? next.length : index, 0, item);
    return command.kind === "weekly-prizes"
      ? [...next].sort((left, right) => (
          (left as WeeklyPrizeConfigItem).rank - (right as WeeklyPrizeConfigItem).rank
        ))
      : next;
  }

  const itemId = command.itemId!;
  const index = current.findIndex((item) => {
    if (sameId(item.id, itemId)) return true;
    if (command.kind === "weekly-prizes") {
      return String((item as WeeklyPrizeConfigItem).rank) === String(itemId);
    }
    return typeof itemId === "string" && itemKey(command.kind, item) === itemId.toLowerCase();
  });
  const next = current.filter((_item, itemIndex) => itemIndex !== index);
  return command.kind === "weekly-prizes" ? compactWeeklyPrizes(next) : next;
}
