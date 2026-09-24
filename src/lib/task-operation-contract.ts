export const INTERNAL_TASK_COMMAND_KINDS = [
  "claim",
  "complete",
  "undo",
  "crew-join",
  "crew-checkin",
  "crew-remove",
  "add",
  "update",
  "delete",
  "approve",
  "approve-all",
  "send-back",
] as const;

export const INTERNAL_TASK_COMMAND_SOURCES = ["hermes", "muse", "server"] as const;

const forbiddenPayloadKeys = new Set([
  "member",
  "amount",
  "payee",
  "points",
  "pendingapproval",
  "history",
  "proto",
  "prototype",
  "constructor",
]);

const credentialKeyFragments = [
  "pin",
  "password",
  "passcode",
  "credential",
  "token",
  "secret",
  "authorization",
  "cookie",
  "session",
  "apikey",
  "bearer",
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isForbiddenPayloadKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    normalized.startsWith("completed") ||
    normalized === "completion" ||
    forbiddenPayloadKeys.has(normalized) ||
    credentialKeyFragments.some((fragment) => normalized.includes(fragment))
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasForbiddenTaskCommandPayloadKey(value: unknown): boolean {
  const seen = new WeakSet<object>();

  const visit = (candidate: unknown): boolean => {
    if (Array.isArray(candidate)) return candidate.some(visit);
    if (!isRecord(candidate)) return false;
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return Object.keys(candidate).some(
      (key) => isForbiddenPayloadKey(key) || visit(candidate[key]),
    );
  };

  return visit(value);
}

export function isInternalTaskCommandKind(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (INTERNAL_TASK_COMMAND_KINDS as readonly string[]).includes(value)
  );
}

export function isInternalTaskCommandSource(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (INTERNAL_TASK_COMMAND_SOURCES as readonly string[]).includes(value)
  );
}

export function hasValidInternalTaskCommandShape(
  command: unknown,
  context: unknown,
): boolean {
  if (!isRecord(command) || !isRecord(context)) return false;
  if (typeof command.operationId !== "string" || !command.operationId.trim()) return false;
  if (!isInternalTaskCommandKind(command.kind)) return false;
  if (!isRecord(command.actor)) return false;
  if (
    typeof command.actor.memberId !== "string" ||
    !command.actor.memberId.trim() ||
    typeof command.actor.name !== "string" ||
    !command.actor.name.trim() ||
    typeof command.actor.role !== "string" ||
    !command.actor.role.trim()
  ) {
    return false;
  }
  if (!isRecord(command.payload)) return false;
  return isInternalTaskCommandSource(context.source);
}
