import { getUserId, isLegacyOwner } from '@/lib/auth';
import { requireLiveSession } from '@/lib/server-auth';
import { NextRequest, NextResponse } from 'next/server';
import {
  getMountain,
  updateMountain,
  deleteMountain,
  addTransaction,
} from '@/lib/money-mountain';
import type { TransactionType, TransactionSource } from '@/db/features/money-mountain';

/**
 * GET /api/money-mountain/[id]
 * Get a single mountain with milestones and transactions.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = await getUserId(request);
    const result = await getMountain(id);
    
    if (!result) {
      return NextResponse.json(
        { error: 'Mountain not found' },
        { status: 404 }
      );
    }
    
    // Check ownership (legacy demo-user rows stay accessible per F8a continuity)
    if (result.mountain.userId !== userId && !isLegacyOwner(result.mountain.userId)) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to get mountain:', error);
    return NextResponse.json(
      { error: 'Failed to get mountain' },
      { status: 500 }
    );
  }
}

// ─── The parent-only gate ───────────────────────────────────────────────────
//
// Every WRITE on a mountain used to sit behind `requireSession` plus an
// ownership check that calls `isLegacyOwner(userId)` — and `isLegacyOwner` is
// true for the shared `demo-user` namespace, so EVERY pre-migration row read
// as owned by EVERY signed-in session. A child or a pet could therefore reach
// `PATCH` with `{"currentAmount": 1000}` and then withdraw it: the body was
// forwarded straight into PocketBase, with no allowlist and no role gate.
//
// The gate re-reads the LIVE PocketBase member row and its CURRENT role — the
// signed cookie's role claim is never trusted on its own, and a PocketBase
// outage is a 503 `identity_unavailable`, never "unverified, so probably a
// parent". Same seam as /api/consuela/planner/apply, /api/services/test and
// /api/recipes/ingest.
async function requireParent(request: NextRequest): Promise<NextResponse | null> {
  const live = await requireLiveSession(request, { requireRole: 'parent' });
  if (live.ok) return null;
  return NextResponse.json({ error: live.error }, { status: live.status });
}

// ─── Field allowlist ────────────────────────────────────────────────────────

/** A rejected body is a 400, not a 500. */
class FieldError extends Error {}

/** "The caller did not send this field" — distinct from "sent it as null". */
const OMIT = Symbol('omit');
type Maybe = typeof OMIT | string | number | boolean | null;

function reject(message: string): never {
  throw new FieldError(message);
}

/** Own-property read only: an inherited `constructor`/`__proto__` is not input. */
function own(body: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(body, key) ? body[key] : OMIT;
}

function asObject(body: unknown, what: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    reject(`${what} must be a JSON object`);
  }
  return body as Record<string, unknown>;
}

function readText(value: unknown, label: string, max: number): Maybe {
  if (value === OMIT) return OMIT;
  if (value === null) return null;
  if (typeof value !== 'string') reject(`${label} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > max) reject(`${label} must be ${max} characters or fewer`);
  return trimmed;
}

function readNonEmptyText(value: unknown, label: string, max: number): Maybe {
  const parsed = readText(value, label, max);
  if (parsed === OMIT) return OMIT;
  if (parsed === null || parsed === '') reject(`${label} cannot be empty`);
  return parsed;
}

function readNumber(
  value: unknown,
  label: string,
  options: { min?: number; max?: number; integer?: boolean; nullable?: boolean },
): Maybe {
  if (value === OMIT) return OMIT;
  if (value === null) {
    if (options.nullable) return null;
    reject(`${label} cannot be null`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    reject(`${label} must be a real number`);
  }
  const n = value as number;
  if (options.integer && !Number.isInteger(n)) reject(`${label} must be a whole number`);
  if (options.min !== undefined && n < options.min) {
    reject(`${label} must be at least ${options.min}`);
  }
  if (options.max !== undefined && n > options.max) {
    reject(`${label} must be at most ${options.max}`);
  }
  return n;
}

function readBoolean(value: unknown, label: string): Maybe {
  if (value === OMIT) return OMIT;
  if (typeof value !== 'boolean') reject(`${label} must be true or false`);
  return value;
}

function readChoice(value: unknown, label: string, allowed: ReadonlySet<string>): Maybe {
  if (value === OMIT) return OMIT;
  if (typeof value !== 'string' || !allowed.has(value)) {
    reject(`${label} must be one of: ${[...allowed].join(', ')}`);
  }
  return value;
}

function readDate(value: unknown, label: string): Maybe {
  const parsed = readText(value, label, 40);
  if (parsed === OMIT || parsed === null) return parsed;
  if (typeof parsed !== 'string') reject(`${label} must be a date like 2026-12-01`);
  const isoDay = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
  if (!isoDay.test(parsed) || Number.isNaN(Date.parse(parsed))) {
    reject(`${label} must be a date like 2026-12-01`);
  }
  return parsed;
}

const CURRENCIES: ReadonlySet<string> = new Set(['USD', 'EUR', 'GBP', 'CAD', 'AUD']);
const MOUNTAIN_THEMES: ReadonlySet<string> = new Set([
  'snow',
  'desert',
  'forest',
  'volcano',
  'cloud',
]);
// `completed` is NOT editable: completion is DERIVED from the balance by
// `addTransaction`, so letting a caller assert it by hand is the same class of
// lie as writing `currentAmount` directly.
const EDITABLE_STATUSES: ReadonlySet<string> = new Set(['active', 'paused']);

// The COMPLETE set of fields PATCH may write. Every other column on
// `money_mountains` is server-owned and is deliberately absent here:
//
//   currentAmount, percentageComplete, milestoneIndex, daysActive,
//   matchedAmount, matchedBy, totalDeposits, totalWithdrawals,
//   transactionCount, isCompleted, completedAt, userId, id, created, updated
//
// A caller-shaped object is never forwarded: the patch is rebuilt key by key
// from this table, and any key outside it is a 400 rather than a silent drop.
const PATCH_FIELDS: Record<string, (value: unknown) => Maybe> = {
  name: (value) => readNonEmptyText(value, 'name', 80),
  description: (value) => readText(value, 'description', 500),
  targetAmount: (value) => readNumber(value, 'targetAmount', { min: 0.01 }),
  currency: (value) => readChoice(value, 'currency', CURRENCIES),
  imageUrl: (value) => readText(value, 'imageUrl', 500),
  icon: (value) => readText(value, 'icon', 8),
  color: (value) => readText(value, 'color', 32),
  mountainTheme: (value) => readChoice(value, 'mountainTheme', MOUNTAIN_THEMES),
  deadline: (value) => readDate(value, 'deadline'),
  status: (value) => readChoice(value, 'status', EDITABLE_STATUSES),
  matchEnabled: (value) => readBoolean(value, 'matchEnabled'),
  matchPercentage: (value) =>
    readNumber(value, 'matchPercentage', { min: 0, max: 100, integer: true }),
  matchCap: (value) => readNumber(value, 'matchCap', { min: 0, nullable: true }),
};

function buildPatch(body: unknown): Record<string, unknown> {
  const record = asObject(body, 'Body');
  const refused = Object.keys(record).filter(
    (key) => !Object.prototype.hasOwnProperty.call(PATCH_FIELDS, key),
  );
  if (refused.length > 0) {
    reject(`This route does not write: ${refused.join(', ')}`);
  }

  // Every field is optional — a PATCH is a partial update — but a body that
  // yields nothing is refused rather than answered with a success it did not
  // perform.
  const patch: Record<string, unknown> = {};
  for (const [key, parse] of Object.entries(PATCH_FIELDS)) {
    const value = parse(own(record, key));
    if (value !== OMIT) patch[key] = value;
  }
  if (Object.keys(patch).length === 0) reject('Nothing to update');
  return patch;
}

// A match row is written by `addTransaction` itself when a parent's match
// applies, so `match` is NOT an accepted caller type: it slipped past the
// insufficient-funds check (which only tests `type === 'withdrawal'`) and past
// the `totalWithdrawals` bookkeeping.
const TRANSACTION_TYPES: ReadonlySet<string> = new Set(['deposit', 'withdrawal']);
const TRANSACTION_SOURCES: ReadonlySet<string> = new Set([
  'allowance',
  'gift',
  'chore',
  'match',
  'bonus',
  'other',
]);

function buildTransaction(body: unknown): {
  type: TransactionType;
  amount: number;
  description: string;
  source: TransactionSource;
  note?: string;
  parentId?: string;
} {
  const record = asObject(body, 'Body');
  const refused = Object.keys(record).filter(
    (key) => !TRANSACTION_BODY_FIELDS.has(key),
  );
  if (refused.length > 0) {
    reject(`This route does not write: ${refused.join(', ')}`);
  }

  const type = readChoice(own(record, 'type'), 'type', TRANSACTION_TYPES);
  if (type === OMIT) reject('type is required');
  const amount = readNumber(own(record, 'amount'), 'amount', { min: 0.01 });
  if (amount === OMIT || amount === null) reject('amount is required');
  const description = readNonEmptyText(own(record, 'description'), 'description', 200);
  if (description === OMIT || description === null) reject('description is required');
  const source = readChoice(own(record, 'source'), 'source', TRANSACTION_SOURCES);
  if (source === OMIT) reject('source is required');
  const note = readText(own(record, 'note'), 'note', 500);
  const parentId = readText(own(record, 'parentId'), 'parentId', 64);

  return {
    type: type as TransactionType,
    amount: amount as number,
    description: description as string,
    source: source as TransactionSource,
    ...(typeof note === 'string' ? { note } : {}),
    ...(typeof parentId === 'string' && parentId ? { parentId } : {}),
  };
}

const TRANSACTION_BODY_FIELDS: ReadonlySet<string> = new Set([
  'type',
  'amount',
  'description',
  'source',
  'note',
  'parentId',
]);

async function readJsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return reject('Body could not be read');
  }
}

/**
 * PATCH /api/money-mountain/[id]
 * Edit a mountain's GOAL — parent-only, and only the allowlisted fields.
 * The balance and every derived counter are unreachable from here by design.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireParent(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const userId = await getUserId(request);
    // Check ownership
    const existing = await getMountain(id);
    if (!existing || (existing.mountain.userId !== userId && !isLegacyOwner(existing.mountain.userId))) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    const patch = buildPatch(await readJsonBody(request));
    const mountain = await updateMountain(id, patch);

    if (!mountain) {
      return NextResponse.json(
        { error: 'Failed to update mountain' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ mountain });
  } catch (error) {
    if (error instanceof FieldError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Failed to update mountain:', error);
    return NextResponse.json(
      { error: 'Failed to update mountain' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/money-mountain/[id]
 * Delete a mountain (and its milestones + transactions) — parent-only: it
 * destroys real savings, so it is a money write, not a personal preference.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireParent(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const userId = await getUserId(request);
    // Check ownership
    const existing = await getMountain(id);
    if (!existing || (existing.mountain.userId !== userId && !isLegacyOwner(existing.mountain.userId))) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }
    
    const success = await deleteMountain(id);
    
    if (!success) {
      return NextResponse.json(
        { error: 'Failed to delete mountain' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete mountain:', error);
    return NextResponse.json(
      { error: 'Failed to delete mountain' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/money-mountain/[id]/transaction
 * Add a deposit or a withdrawal to a mountain — parent-only, because this is
 * the route that actually moves the balance.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireParent(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const userId = await getUserId(request);
    // Check ownership
    const existing = await getMountain(id);
    if (!existing || (existing.mountain.userId !== userId && !isLegacyOwner(existing.mountain.userId))) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    const data = buildTransaction(await readJsonBody(request));

    const result = await addTransaction(id, userId, data);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to add transaction. Insufficient funds for withdrawal.' },
        { status: 400 }
      );
    }
    
    return NextResponse.json({
      success: true,
      matchAmount: result.matchAmount,
      milestoneReached: result.milestoneReached,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof FieldError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Failed to add transaction:', error);
    return NextResponse.json(
      { error: 'Failed to add transaction' },
      { status: 500 }
    );
  }
}
