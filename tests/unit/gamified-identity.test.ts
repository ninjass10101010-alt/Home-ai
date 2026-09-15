/**
 * F8a data continuity — the gamified routes (money-mountain, skill-tree,
 * time-capsules) read a member's rows PLUS the legacy `demo-user` rows that
 * predate the per-member identity migration, while new writes stamp the
 * signed-session member.
 *
 * Route-level proof for money-mountain: a legacy row and the session member's
 * row both come back on GET, and POST creates with the session name.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signSession, SESSION_COOKIE } from '@/lib/session';

const h = vi.hoisted(() => ({
  created: [] as Array<Record<string, any>>,
  mountains: [
    { id: 'legacy-1', userId: 'demo-user', name: 'Legacy goal' },
    { id: 'mine-1', userId: 'Rebecca', name: 'My goal' },
  ],
}));

vi.mock('@/lib/pb-auth', () => ({
  getAuthedPB: vi.fn(async () => ({
    collection: (name: string) => ({
      getFullList: vi.fn(async (opts: { filter?: string } = {}) => {
        if (name !== 'money_mountains') return [];
        const filter = opts.filter ?? '';
        return h.mountains.filter((m) => filter.includes(`userId = "${m.userId}"`));
      }),
      getOne: vi.fn(async () => null),
      getFirstListItem: vi.fn(async () => null),
      create: vi.fn(async (data: Record<string, any>) => {
        const record = { id: `new-${h.created.length + 1}`, ...data };
        if (name === 'money_mountains') h.created.push(record);
        return record;
      }),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => true),
    }),
  })),
}));

import { GET, POST } from '@/app/api/money-mountain/route';

function req(method: string, token?: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/money-mountain', {
    method,
    headers: {
      ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'test-secret-0123456789');
  h.created.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe('gamified route identity (session + legacy continuity)', () => {
  it("GET returns the session member's rows AND the legacy demo-user rows", async () => {
    const token = await signSession({ memberId: 'm1', name: 'Rebecca', role: 'parent' });
    const res = await GET(req('GET', token));

    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.mountains as Array<{ id: string }>).map((m) => m.id).sort();
    expect(ids).toEqual(['legacy-1', 'mine-1']);
  });

  it('POST stamps the signed-session member, not demo-user', async () => {
    const token = await signSession({ memberId: 'm1', name: 'Rebecca', role: 'parent' });
    const res = await POST(req('POST', token, { name: 'New goal', targetAmount: 100 }));

    expect(res.status).toBe(201);
    const mountain = h.created.find((c) => c.name === 'New goal');
    expect(mountain?.userId).toBe('Rebecca');
    expect(h.created.some((c) => c.userId === 'demo-user')).toBe(false);
  });
});
