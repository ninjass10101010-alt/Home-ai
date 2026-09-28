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

/** Mirrors `ClaimAuthentication` in `src/lib/task-claim.ts`. The claim seam keys
 *  the queue-vs-pay branch off this value, so anything outside the vocabulary
 *  must be refused here rather than reaching a handler. */
export const INTERNAL_TASK_COMMAND_AUTHENTICATIONS = ["pin", "session", "internal"] as const;

const authorityTokens = new Set([
  "member",
  "amount",
  "payee",
  "point",
  "history",
  "ledger",
  "transaction",
  "recipient",
  "payer",
  "actor",
  "role",
  "user",
  "claimant",
  "operation",
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

const isoDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-](\d{2}):(\d{2}))$/i;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = value.trim();
  const match = isoDateTimePattern.exec(timestamp);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return null;
  }
  const epoch = Date.parse(timestamp);
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : null;
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
    compact === "opid" ||
    tokens.some((token, index) => token === "op" && tokens[index + 1] === "id") ||
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

export function isInternalTaskCommandAuthentication(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (INTERNAL_TASK_COMMAND_AUTHENTICATIONS as readonly string[]).includes(value)
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
  // Optional: the approve, manage and assistant-manage producers legitimately
  // omit it and the claim seam defaults to "internal". Present-but-wrong is
  // not — an unrecognised value would fail both the `=== "internal"` and the
  // `!== "session"` tests and silently act as a paying caller.
  if (
    command.actor.authentication !== undefined &&
    !isInternalTaskCommandAuthentication(command.actor.authentication)
  ) {
    return false;
  }
  if (!isRecord(command.payload)) return false;
  return isInternalTaskCommandSource(context.source);
}
