/**
 * Skill-tree identity — the get-or-create profile helper must prefer the exact
 * session-member row, create a per-member row when the member has none, and
 * treat the legacy `demo-user` row strictly as a READ-only fallback. Writers
 * must never mutate the legacy row.
 *
 * Regression proof for the shared-legacy-profile bug: before the fix, the
 * combined `userId = "<member>" || userId = "demo-user"` query returned
 * `items[0]` (legacy first), so every writer updated the legacy profile and no
 * per-member profile was ever created.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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
    profiles: [] as any[],
    quests: [] as any[],
    achievements: [] as any[],
    userAchievements: [] as any[],
    branches: [] as any[],
    updates: [] as Array<{ collection: string; id: string; data: any }>,
    creates: [] as Array<{ collection: string; data: any }>,
    profile,
  };
});

vi.mock('@/lib/pb-auth', () => {
  const allRows = (name: string): any[] => {
    switch (name) {
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
          h.creates.push({ collection: name, data: record });
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

import { getSkillTreeProfile, completeQuest, startQuest } from '@/lib/skill-tree';

beforeEach(() => {
  h.profiles = [
    h.profile({ id: 'legacy-1', userId: 'demo-user', totalXP: 500, level: 4, achievementCount: 3 }),
  ];
  h.quests = [
    {
      id: 'q1',
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
  h.updates = [];
  h.creates = [];
});

describe('skill-tree identity (per-member profiles, legacy read fallback)', () => {
  it('reads the legacy profile when the member has none (read-only fallback)', async () => {
    const profile = await getSkillTreeProfile('Aurora');
    expect(profile?.id).toBe('legacy-1');
  });

  it('reads the exact member profile when both member and legacy rows exist', async () => {
    h.profiles.push(h.profile({ id: 'mine-1', userId: 'Aurora', totalXP: 200, level: 2 }));

    const profile = await getSkillTreeProfile('Aurora');

    expect(profile?.id).toBe('mine-1');
  });

  it('startQuest creates a per-member profile and never writes the legacy row', async () => {
    const ok = await startQuest('q1', 'Aurora');
    expect(ok).toBe(true);

    const member = h.profiles.find((p) => p.userId === 'Aurora');
    expect(member).toBeDefined();
    expect(member!.activeQuests).toEqual(['q1']);

    const legacy = h.profiles.find((p) => p.id === 'legacy-1')!;
    expect(legacy.activeQuests).toEqual([]);
    expect(h.updates.some((u) => u.id === 'legacy-1')).toBe(false);
  });

  it('completeQuest creates a per-member profile and leaves the legacy row untouched', async () => {
    const res = await completeQuest('q1', 'Aurora');
    expect(res.success).toBe(true);

    const member = h.profiles.find((p) => p.userId === 'Aurora');
    expect(member).toBeDefined();
    expect(member!.totalXP).toBe(10);

    const legacy = h.profiles.find((p) => p.id === 'legacy-1')!;
    expect(legacy.totalXP).toBe(500);
    expect(h.updates.some((u) => u.id === 'legacy-1')).toBe(false);
  });

  it('completeQuest writes to the exact member row when both rows exist', async () => {
    h.profiles.push(h.profile({ id: 'mine-1', userId: 'Aurora', totalXP: 200, level: 2 }));

    const res = await completeQuest('q1', 'Aurora');
    expect(res.success).toBe(true);

    expect(h.updates.some((u) => u.id === 'mine-1')).toBe(true);
    expect(h.updates.some((u) => u.id === 'legacy-1')).toBe(false);
    expect(h.profiles.find((p) => p.id === 'legacy-1')!.totalXP).toBe(500);
    expect(h.profiles.find((p) => p.id === 'mine-1')!.totalXP).toBeGreaterThan(200);
  });
});
