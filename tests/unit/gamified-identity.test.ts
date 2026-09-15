/**
 * F8a data continuity — the gamified routes (money-mountain, skill-tree,
 * time-capsules) read a member's rows PLUS the legacy `demo-user` rows that
 * predate the per-member identity migration, while new writes stamp the
 * signed-session member.
 *
 * Route-level proof for all three families:
 *  - money-mountain: legacy + session rows both come back on GET; POST creates
 *    with the session name.
 *  - time-capsules: legacy + session rows both come back on GET; POST creates
 *    with the session name.
 *  - skill-tree: GET prefers the session member's profile (legacy is a read
 *    fallback only); startQuest creates/stamps a per-member profile.
 *  - every write handler rejects a session-less request with 401 and leaves
 *    PocketBase untouched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signSession, SESSION_COOKIE } from '@/lib/session';

const h = vi.hoisted(() => {
  const profile = (over: Record<string, any> = {}) => ({
    totalXP: 0,
    level: 1,
    xpToNextLevel: 100,
    unlockedBranches: [],
    completedQuests: [],
    activeQuests: [],
    achievementCount: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastActivityDate: '',
    createdAt: '',
    updatedAt: '',
    ...over,
  });
  return {
    created: [] as Array<{ collection: string; data: any }>,
    updates: [] as Array<{ collection: string; id: string; data: any }>,
    mountains: [] as any[],
    capsules: [] as any[],
    profiles: [] as any[],
    quests: [] as any[],
    achievements: [] as any[],
    userAchievements: [] as any[],
    branches: [] as any[],
    profile,
  };
});

vi.mock('@/lib/pb-auth', () => {
  const allRows = (name: string): any[] => {
    switch (name) {
      case 'money_mountains':
        return h.mountains;
      case 'time_capsules':
        return h.capsules;
      case 'skill_tree_profiles':
        return h.profiles;
      case 'quests':
        return h.quests;
      case 'achievements':
        return h.achievements;
      case 'user_achievements':
        return h.userAchievements;
      case 'skill_branches':
        return h.branches;
      default:
        return [];
    }
  };

  const filterRows = (name: string, filter: string): any[] => {
    const rows = allRows(name);
    if (!filter) return rows;

    const userIds = [...filter.matchAll(/userId = "([^"]*)"/g)].map((m) => m[1]);
    if (userIds.length) return rows.filter((r) => userIds.includes(r.userId));

    const createdBys = [...filter.matchAll(/createdBy = "([^"]*)"/g)].map((m) => m[1]);
    const recipientTildes = [...filter.matchAll(/\?~ "([^"]*)"/g)].map((m) => m[1]);
    const familyWide = /isFamilyWide = true/.test(filter);
    if (createdBys.length || recipientTildes.length || familyWide) {
      return rows.filter(
        (r) =>
          createdBys.includes(r.createdBy) ||
          (r.recipients || []).some((x: string) => recipientTildes.includes(x)) ||
          (familyWide && r.isFamilyWide === true)
      );
    }

    return rows;
  };

  return {
    getAuthedPB: vi.fn(async () => ({
      collection: (name: string) => ({
        getList: vi.fn(async (_page: number, _per: number, opts: any = {}) => {
          const items = filterRows(name, opts?.filter ?? '');
          return { items, totalItems: items.length, page: 1, perPage: items.length, totalPages: 1 };
        }),
        getFullList: vi.fn(async (opts: any = {}) => filterRows(name, opts?.filter ?? '')),
        getOne: vi.fn(async (id: string) => {
          const row = allRows(name).find((r) => r.id === id);
          if (!row) throw new Error('not found');
          return row;
        }),
        getFirstListItem: vi.fn(async (filter: string) => {
          const row = filterRows(name, filter)[0];
          if (!row) throw new Error('not found');
          return row;
        }),
        create: vi.fn(async (data: any) => {
          const rows = allRows(name);
          const record = { id: `created-${name}-${rows.length + 1}`, ...data };
          rows.push(record);
          h.created.push({ collection: name, data: record });
          return record;
        }),
        update: vi.fn(async (id: string, data: any) => {
          const row = allRows(name).find((r) => r.id === id);
          if (row) Object.assign(row, data);
          h.updates.push({ collection: name, id, data });
          return row ?? { id, ...data };
        }),
        delete: vi.fn(async () => true),
      }),
    })),
  };
});

import { GET as mountainsGET, POST as mountainsPOST } from '@/app/api/money-mountain/route';
import { GET as capsulesGET, POST as capsulesPOST } from '@/app/api/time-capsules/route';
import { GET as treeGET } from '@/app/api/skill-tree/route';
import { POST as startQuestPOST } from '@/app/api/skill-tree/quests/[id]/start/route';

function req(
  url: string,
  init: { method?: string; token?: string; body?: unknown } = {}
): NextRequest {
  return new NextRequest(url, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.token ? { cookie: `${SESSION_COOKIE}=${init.token}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'test-secret-0123456789');
  h.created = [];
  h.updates = [];
  h.mountains = [
    { id: 'legacy-mm', userId: 'demo-user', name: 'Legacy goal' },
    { id: 'mine-mm', userId: 'Rebecca', name: 'My goal' },
  ];
  h.capsules = [
    { id: 'legacy-cap', createdBy: 'demo-user', recipients: [], isFamilyWide: false, title: 'Legacy capsule' },
    { id: 'mine-cap', createdBy: 'Rebecca', recipients: [], isFamilyWide: false, title: 'My capsule' },
  ];
  h.profiles = [
    h.profile({ id: 'legacy-prof', userId: 'demo-user', totalXP: 500, level: 4 }),
    h.profile({ id: 'mine-prof', userId: 'Rebecca', totalXP: 100, level: 2 }),
  ];
  h.quests = [
    {
      id: 'quest-1',
      branchId: 'b1',
      title: 'Read a book',
      type: 'read',
      difficulty: 'easy',
      xpReward: 10,
      status: 'available',
      repeatable: true,
      completionCount: 0,
      order: 0,
      isDefault: true,
      requirementType: 'count',
      requirementValue: 1,
      assignedTo: [],
      createdAt: '',
      updatedAt: '',
    },
  ];
  h.achievements = [];
  h.userAchievements = [];
  h.branches = [];
});

afterEach(() => vi.unstubAllEnvs());

describe('gamified route identity (session + legacy continuity)', () => {
  describe('money-mountain', () => {
    it("GET returns the session member's rows AND the legacy demo-user rows", async () => {
      const token = await signSession({ memberId: 'm1', name: 'Rebecca', role: 'parent' });
      const res = await mountainsGET(req('http://localhost:3000/api/money-mountain', { token }));

      expect(res.status).toBe(200);
      const body = await res.json();
      const ids = (body.mountains as Array<{ id: string }>).map((m) => m.id).sort();
      expect(ids).toEqual(['legacy-mm', 'mine-mm']);
    });

    it('POST stamps the signed-session member, not demo-user', async () => {
      const token = await signSession({ memberId: 'm1', name: 'Rebecca', role: 'parent' });
      const res = await mountainsPOST(
        req('http://localhost:3000/api/money-mountain', {
          method: 'POST',
          token,
          body: { name: 'New goal', targetAmount: 100 },
        })
      );

      expect(res.status).toBe(201);
      const created = h.created.find((c) => c.collection === 'money_mountains' && c.data.name === 'New goal');
      expect(created?.data.userId).toBe('Rebecca');
      expect(h.created.some((c) => c.collection === 'money_mountains' && c.data.userId === 'demo-user')).toBe(false);
    });

    it('POST returns 401 and does not touch PB when there is no session', async () => {
      const res = await mountainsPOST(
        req('http://localhost:3000/api/money-mountain', { method: 'POST', body: { name: 'Nope', targetAmount: 100 } })
      );

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
      expect(h.created.some((c) => c.collection === 'money_mountains')).toBe(false);
    });
  });

  describe('time-capsules', () => {
    it("GET returns the session member's capsules AND the legacy demo-user capsules", async () => {
      const token = await signSession({ memberId: 'm1', name: 'Rebecca', role: 'parent' });
      const res = await capsulesGET(req('http://localhost:3000/api/time-capsules', { token }));

      expect(res.status).toBe(200);
      const body = await res.json();
      const ids = (body.capsules as Array<{ id: string }>).map((c) => c.id).sort();
      expect(ids).toEqual(['legacy-cap', 'mine-cap']);
    });

    it('POST stamps the signed-session member, not demo-user', async () => {
      const token = await signSession({ memberId: 'm1', name: 'Rebecca', role: 'parent' });
      const res = await capsulesPOST(
        req('http://localhost:3000/api/time-capsules', {
          method: 'POST',
          token,
          body: { title: 'New capsule', unlockDate: new Date(Date.now() + 86400000).toISOString() },
        })
      );

      expect(res.status).toBe(201);
      const created = h.created.find((c) => c.collection === 'time_capsules' && c.data.title === 'New capsule');
      expect(created?.data.createdBy).toBe('Rebecca');
      expect(h.created.some((c) => c.collection === 'time_capsules' && c.data.createdBy === 'demo-user')).toBe(false);
    });

    it('POST returns 401 and does not touch PB when there is no session', async () => {
      const res = await capsulesPOST(
        req('http://localhost:3000/api/time-capsules', {
          method: 'POST',
          body: { title: 'Nope', unlockDate: new Date(Date.now() + 86400000).toISOString() },
        })
      );

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
      expect(h.created.some((c) => c.collection === 'time_capsules')).toBe(false);
    });
  });

  describe('skill-tree', () => {
    it("GET returns the session member's profile while a legacy row exists", async () => {
      const token = await signSession({ memberId: 'm1', name: 'Rebecca', role: 'parent' });
      const res = await treeGET(req('http://localhost:3000/api/skill-tree', { token }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.profile.id).toBe('mine-prof');
    });

    it('GET falls back to the legacy profile when the member has none', async () => {
      h.profiles = [h.profile({ id: 'legacy-prof', userId: 'demo-user', totalXP: 500, level: 4 })];
      const token = await signSession({ memberId: 'm1', name: 'Rebecca', role: 'parent' });
      const res = await treeGET(req('http://localhost:3000/api/skill-tree', { token }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.profile.id).toBe('legacy-prof');
    });

    it('startQuest creates a per-member profile stamped with the session member', async () => {
      // Only the legacy row exists, so the write must create a per-member row.
      h.profiles = [h.profile({ id: 'legacy-prof', userId: 'demo-user', totalXP: 500, level: 4 })];
      const token = await signSession({ memberId: 'm1', name: 'Rebecca', role: 'parent' });
      const res = await startQuestPOST(
        req('http://localhost:3000/api/skill-tree/quests/quest-1/start', { method: 'POST', token }),
        { params: Promise.resolve({ id: 'quest-1' }) }
      );

      expect(res.status).toBe(200);
      const created = h.created.find((c) => c.collection === 'skill_tree_profiles');
      expect(created?.data.userId).toBe('Rebecca');
      expect(h.updates.some((u) => u.id === 'legacy-prof')).toBe(false);
    });

    it('startQuest returns 401 and does not touch PB when there is no session', async () => {
      const res = await startQuestPOST(
        req('http://localhost:3000/api/skill-tree/quests/quest-1/start', { method: 'POST' }),
        { params: Promise.resolve({ id: 'quest-1' }) }
      );

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
      expect(h.created.some((c) => c.collection === 'skill_tree_profiles')).toBe(false);
    });
  });
});
