/**
 * API Authentication Utility
 *
 * Identity is derived from the HMAC-signed `consuela_session` cookie. The
 * client-supplied `x-user-id` header is NOT trusted (F8a) — it previously let
 * any session spoof any member id and forced every caller onto one shared
 * namespace.
 */

import { NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE } from '@/lib/session';

/**
 * Legacy namespace every pre-migration row was written under. New writes stamp
 * the signed-session member name, but reads (and ownership checks) must keep
 * including this id so existing demo-user rows stay visible to the family.
 */
export const DEMO_USER_ID = 'demo-user';

/**
 * Known demo user IDs for development.
 * In production, these come from the database.
 */
const DEMO_USER_IDS = new Set([
  'demo-user',
  'demo',
  'user-1',
  'user-2',
  'user-3',
  'user-4',
  'user-5',
  'user-6',
  'user-7',
  'user-8',
  'user-9',
]);

/**
 * Sanitize a session-derived identity before it is interpolated into a
 * PocketBase filter string. A member name containing a double quote would
 * otherwise break out of the `userId = "..."` literal and corrupt the query.
 * Whitespace is trimmed (a blank id would produce `userId = ""`, which matches
 * nothing useful); a value that sanitizes to empty falls back to the legacy
 * `demo-user` namespace.
 */
export function sanitizeUserId(raw: string | null | undefined): string {
  const cleaned = (raw ?? '').replace(/"/g, '').trim();
  return cleaned.length > 0 ? cleaned : DEMO_USER_ID;
}

/**
 * Extract the caller's identity from the signed session cookie.
 *
 * @returns The session member's sanitized name, or the legacy `demo-user`
 *          namespace when there is no valid session.
 */
export async function getUserId(request: NextRequest): Promise<string> {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  return sanitizeUserId(session?.name);
}

/**
 * Resolve the signed session for a request, or `null` when the request carries
 * no valid session. WRITE handlers call this so an unauthenticated request is
 * rejected in-route (401) instead of silently degrading to the shared
 * `demo-user` namespace via {@link getUserId}. Middleware still gates every
 * route; this is defense-in-depth for the gamified write surfaces.
 */
export async function requireSession(request: NextRequest) {
  return verifySession(request.cookies.get(SESSION_COOKIE)?.value);
}

/**
 * Whether a stored owner id is the legacy shared namespace. Used by the
 * gamified routes' ownership checks so a member can still open/modify rows
 * created before the per-member identity migration.
 */
export function isLegacyOwner(ownerId: string | null | undefined): boolean {
  return ownerId === DEMO_USER_ID;
}

/**
 * Validate that a user ID string is well-formed.
 * Prevents injection attacks and invalid IDs.
 */
export function isValidUserId(userId: string): boolean {
  // Must be non-empty, alphanumeric with hyphens/underscores, max 64 chars
  return /^[a-zA-Z0-9_-]{1,64}$/.test(userId);
}

/**
 * Check if request is from a demo/development user.
 */
export function isDemoUser(userId: string): boolean {
  return DEMO_USER_IDS.has(userId);
}

/**
 * Custom authentication error.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number = 401
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Helper to create 401 response.
 */
export function unauthorizedResponse(message = 'Authentication required') {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Helper to create 403 response.
 */
export function forbiddenResponse(message = 'Access denied') {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}
