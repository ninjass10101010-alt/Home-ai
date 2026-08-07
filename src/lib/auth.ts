/**
 * API Authentication Utility
 * 
 * Provides secure user identification from incoming requests.
 * Currently uses PIN-based member auth (demo mode).
 * 
 * In production, this should integrate with:
 * - PocketBase auth tokens
 * - JWT/session cookies
 * - OAuth providers
 */

import { NextRequest } from 'next/server';

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
 * Extract and validate user ID from request.
 * 
 * Priority order:
 * 1. x-user-id header (current demo mode)
 * 2. Authorization header (future: Bearer token)
 * 3. Cookie session (future: session-based auth)
 * 
 * @param request - Next.js request object
 * @returns User ID string or null if not authenticated
 */
export function getUserId(request: NextRequest): string | null {
  // 1. Check x-user-id header (demo mode)
  const headerUserId = request.headers.get('x-user-id');
  if (headerUserId && isValidUserId(headerUserId)) {
    return headerUserId;
  }

  // 2. Check Authorization header (future)
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    // TODO: Validate JWT/token and extract user ID
    // const decoded = verifyToken(token);
    // return decoded?.userId || null;
  }

  // 3. Check cookies (future)
  // const sessionCookie = request.cookies.get('session');
  // if (sessionCookie) {
  //   const session = verifySession(sessionCookie.value);
  //   return session?.userId || null;
  // }

  return null;
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
 * Require user authentication.
 * Returns user ID or throws 401 error.
 * 
 * Usage in API routes:
 * ```ts
 * const userId = requireAuth(request);
 * ```
 */
export function requireAuth(request: NextRequest): string {
  const userId = getUserId(request);
  if (!userId) {
    throw new AuthError('Authentication required', 401);
  }
  return userId;
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
