/**
 * F8a — getUserId must derive identity from the signed session cookie.
 *
 * It never trusts client-supplied headers: a spoofed `x-user-id: admin` on a
 * real session must not change the answer, and with no session the function
 * falls back to the legacy `demo-user` namespace (not the header).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getUserId, DEMO_USER_ID } from '@/lib/auth';
import { signSession, SESSION_COOKIE } from '@/lib/session';

function req(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/test', { headers });
}

beforeEach(() => vi.stubEnv('SESSION_SECRET', 'test-secret-0123456789'));
afterEach(() => vi.unstubAllEnvs());

describe('getUserId — session-derived identity (F8a)', () => {
  it('returns the signed session member name for a valid session', async () => {
    const token = await signSession({ memberId: 'm1', name: 'Rebecca', role: 'parent' });
    const request = req({ cookie: `${SESSION_COOKIE}=${token}` });

    expect(await getUserId(request)).toBe('Rebecca');
  });

  it('returns "demo-user" when there is no session', async () => {
    expect(await getUserId(req())).toBe(DEMO_USER_ID);
  });

  it('does NOT let a client-supplied x-user-id override the session', async () => {
    const token = await signSession({ memberId: 'm1', name: 'Rebecca', role: 'child' });
    const request = req({ cookie: `${SESSION_COOKIE}=${token}`, 'x-user-id': 'admin' });

    expect(await getUserId(request)).toBe('Rebecca');
  });

  it('does NOT fall back to a spoofed x-user-id when there is no session', async () => {
    const request = req({ 'x-user-id': 'admin' });

    expect(await getUserId(request)).toBe(DEMO_USER_ID);
  });

  it('ignores a tampered session cookie', async () => {
    const request = req({ cookie: `${SESSION_COOKIE}=v1.bogus.sig` });

    expect(await getUserId(request)).toBe(DEMO_USER_ID);
  });
});
