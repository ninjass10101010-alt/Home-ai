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

const authorityTokens = new Set([
  "member",
  "amount",
  "payee",
  "point",
  "history",
  "pending",
  "approval",
]);

const credentialTokens = new Set([
  "pin",
  "password",
  "passcode",
  "credential",
  "token",
  "secret",
  "authorization",
  "cookie",
  "session",
  "bearer",
  "apikey",
]);

const unsafeRecordTokens = new Set([
  "proto",
  "prototype",
  "constructor",
  "tostring",
  "valueof",
  "hasownproperty",
  "isprototypeof",
  "propertyisenumerable",
  "tolocalestring",
]);

const unsafeOperationIds = new Set(
  [...Object.getOwnPropertyNames(Object.prototype), "__proto__", "prototype"].map((key) => key.toLowerCase()),
);

function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function singular(token: string): string {
  return token.length > 1 && token.endsWith("s") ? token.slice(0, -1) : token;
}

function isUnsafeOperationId(operationId: string): boolean {
  return unsafeOperationIds.has(operationId.toLowerCase());
}

export function normalizeOperationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const operationId = value.trim();
  return operationId && !isUnsafeOperationId(operationId) ? operationId : null;
}

export function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = value.trim();
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

export function isNormalizedOperationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    Boolean(value) &&
    !isUnsafeOperationId(value)
  );
}

function hasNormalizedBoundary(values: Set<string>, value: string): boolean {
  for (const candidate of values) {
    if (value.startsWith(candidate) || value.endsWith(candidate)) return true;
  }
  return false;
}

function isForbiddenPayloadKey(key: string): boolean {
  const tokens = keyTokens(key);
  const compact = tokens.join("");
  const tokenMatch = tokens.some((token) => {
    const normalized = singular(token);
    return (
      authorityTokens.has(normalized) ||
      credentialTokens.has(normalized) ||
      unsafeRecordTokens.has(normalized) ||
      token.startsWith("completed") ||
      token.startsWith("completion")
    );
  });
  return (
    tokenMatch ||
    compact.startsWith("completed") ||
    compact.startsWith("completion") ||
    hasNormalizedBoundary(authorityTokens, compact) ||
    hasNormalizedBoundary(credentialTokens, compact) ||
    hasNormalizedBoundary(unsafeRecordTokens, compact)
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
  if (!isNormalizedOperationId(command.operationId)) return false;
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
