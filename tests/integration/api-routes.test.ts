/**
 * Integration tests for feature API routes
 * Tests request/response handling, auth validation, and error cases
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as auth from '@/lib/auth';
import * as pb from '@/lib/pb';

// Mock auth utility
vi.mock('@/lib/auth', () => ({
  getUserId: vi.fn(),
  unauthorizedResponse: vi.fn(() => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })),
  requireAuth: vi.fn(),
  isDemoUser: vi.fn(() => false),
  AuthError: class AuthError extends Error {},
  forbiddenResponse: vi.fn(() => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })),
}));

// Mock PocketBase
vi.mock('@/lib/pb', () => ({
  getPB: vi.fn(() => ({
    collection: vi.fn(() => ({
      getFullList: vi.fn(() => Promise.resolve([])),
      getOne: vi.fn(() => Promise.resolve(null)),
      create: vi.fn(() => Promise.resolve({ id: 'test-id' })),
      update: vi.fn(() => Promise.resolve({ id: 'test-id' })),
      delete: vi.fn(() => Promise.resolve(true)),
    })),
  })),
  getAdminPB: vi.fn(() => ({
    authStore: { save: vi.fn(), clear: vi.fn(), token: '' },
    collection: vi.fn(() => ({
      getFullList: vi.fn(() => Promise.resolve([])),
      getOne: vi.fn(() => Promise.resolve(null)),
      create: vi.fn(() => Promise.resolve({ id: 'test-id' })),
      update: vi.fn(() => Promise.resolve({ id: 'test-id' })),
      delete: vi.fn(() => Promise.resolve(true)),
      authWithPassword: vi.fn(() => Promise.resolve({ token: 'test-token' })),
    })),
  })),
}));

// Mock server-side PIN verification so PATCH routes can pass auth gate in tests
vi.mock('@/lib/server-auth', () => ({
  verifyPinAgainstAnyMember: vi.fn(() => Promise.resolve({ id: 'member-1', name: 'Test Member' })),
}));

// Mock skill tree lib functions
vi.mock('@/lib/skill-tree', () => ({
  getSkillTreeVisualization: vi.fn(() => Promise.resolve({
    profile: { id: 'profile-1', userId: 'user-1', level: 1, xp: 0 },
    branches: [],
    quests: [],
    achievements: [],
  })),
  startQuest: vi.fn(() => Promise.resolve({ success: true })),
  completeQuest: vi.fn(() => Promise.resolve({ success: true, xpEarned: 50, newLevel: 1, leveledUp: false })),
  unlockBranch: vi.fn(() => Promise.resolve({ success: true })),
}));

describe('Money Mountain API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/money-mountain', () => {
    it('returns 401 when no user ID provided', async () => {
      vi.mocked(auth.getUserId).mockReturnValue(null);
      
      const { GET } = await import('@/app/api/money-mountain/route');
      const request = new NextRequest('http://localhost:3000/api/money-mountain');
      const response = await GET(request);
      
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 200 with mountains when authenticated', async () => {
      vi.mocked(auth.getUserId).mockReturnValue('user-1');
      
      const { GET } = await import('@/app/api/money-mountain/route');
      const request = new NextRequest('http://localhost:3000/api/money-mountain');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty('mountains');
      expect(Array.isArray(body.mountains)).toBe(true);
    });
  });

  describe('POST /api/money-mountain', () => {
    it('returns 401 when no user ID provided', async () => {
      vi.mocked(auth.getUserId).mockReturnValue(null);
      
      const { POST } = await import('@/app/api/money-mountain/route');
      const request = new NextRequest('http://localhost:3000/api/money-mountain', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test Mountain', targetAmount: 100 }),
      });
      const response = await POST(request);
      
      expect(response.status).toBe(401);
    });

    it('returns 400 when name is missing', async () => {
      vi.mocked(auth.getUserId).mockReturnValue('user-1');
      
      const { POST } = await import('@/app/api/money-mountain/route');
      const request = new NextRequest('http://localhost:3000/api/money-mountain', {
        method: 'POST',
        body: JSON.stringify({ targetAmount: 100 }),
      });
      const response = await POST(request);
      
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Name and target amount are required');
    });

    it('returns 400 when targetAmount is missing', async () => {
      vi.mocked(auth.getUserId).mockReturnValue('user-1');
      
      const { POST } = await import('@/app/api/money-mountain/route');
      const request = new NextRequest('http://localhost:3000/api/money-mountain', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test Mountain' }),
      });
      const response = await POST(request);
      
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Name and target amount are required');
    });

    it('returns 201 when mountain is created successfully', async () => {
      vi.mocked(auth.getUserId).mockReturnValue('user-1');
      
      const { POST } = await import('@/app/api/money-mountain/route');
      const request = new NextRequest('http://localhost:3000/api/money-mountain', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test Mountain', targetAmount: 100 }),
      });
      const response = await POST(request);
      
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body).toHaveProperty('mountain');
    });
  });
});

describe('Time Capsules API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/time-capsules', () => {
    it('returns 401 when no user ID provided', async () => {
      vi.mocked(auth.getUserId).mockReturnValue(null);
      
      const { GET } = await import('@/app/api/time-capsules/route');
      const request = new NextRequest('http://localhost:3000/api/time-capsules');
      const response = await GET(request);
      
      expect(response.status).toBe(401);
    });

    it('returns 200 with capsules when authenticated', async () => {
      vi.mocked(auth.getUserId).mockReturnValue('user-1');
      
      const { GET } = await import('@/app/api/time-capsules/route');
      const request = new NextRequest('http://localhost:3000/api/time-capsules');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty('capsules');
      expect(Array.isArray(body.capsules)).toBe(true);
    });
  });

  describe('POST /api/time-capsules', () => {
    it('returns 401 when no user ID provided', async () => {
      vi.mocked(auth.getUserId).mockReturnValue(null);
      
      const { POST } = await import('@/app/api/time-capsules/route');
      const request = new NextRequest('http://localhost:3000/api/time-capsules', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Test Capsule',
          unlockDate: new Date(Date.now() + 86400000).toISOString(),
        }),
      });
      const response = await POST(request);
      
      expect(response.status).toBe(401);
    });

    it('returns 400 when title is missing', async () => {
      vi.mocked(auth.getUserId).mockReturnValue('user-1');
      
      const { POST } = await import('@/app/api/time-capsules/route');
      const request = new NextRequest('http://localhost:3000/api/time-capsules', {
        method: 'POST',
        body: JSON.stringify({
          unlockDate: new Date(Date.now() + 86400000).toISOString(),
        }),
      });
      const response = await POST(request);
      
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Title and unlock date are required');
    });

    it('returns 400 when unlock date is missing', async () => {
      vi.mocked(auth.getUserId).mockReturnValue('user-1');
      
      const { POST } = await import('@/app/api/time-capsules/route');
      const request = new NextRequest('http://localhost:3000/api/time-capsules', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Test Capsule',
        }),
      });
      const response = await POST(request);
      
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Title and unlock date are required');
    });

    it('returns 400 when unlock date is in the past', async () => {
      vi.mocked(auth.getUserId).mockReturnValue('user-1');
      
      const { POST } = await import('@/app/api/time-capsules/route');
      const request = new NextRequest('http://localhost:3000/api/time-capsules', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Test Capsule',
          unlockDate: new Date(Date.now() - 86400000).toISOString(),
        }),
      });
      const response = await POST(request);
      
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Unlock date must be in the future');
    });

    it('returns 201 when capsule is created successfully', async () => {
      vi.mocked(auth.getUserId).mockReturnValue('user-1');
      
      const { POST } = await import('@/app/api/time-capsules/route');
      const request = new NextRequest('http://localhost:3000/api/time-capsules', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Test Capsule',
          unlockDate: new Date(Date.now() + 86400000).toISOString(),
        }),
      });
      const response = await POST(request);
      
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body).toHaveProperty('capsule');
    });
  });
});

describe('Skill Tree API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/skill-tree', () => {
    it('returns 401 when no user ID provided', async () => {
      vi.mocked(auth.getUserId).mockReturnValue(null);
      
      const { GET } = await import('@/app/api/skill-tree/route');
      const request = new NextRequest('http://localhost:3000/api/skill-tree');
      const response = await GET(request);
      
      expect(response.status).toBe(401);
    });

    it('returns 200 with skill tree data when authenticated', async () => {
      vi.mocked(auth.getUserId).mockReturnValue('user-1');
      
      const { GET } = await import('@/app/api/skill-tree/route');
      const request = new NextRequest('http://localhost:3000/api/skill-tree');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      // Should return skill tree data structure
      const body = await response.json();
      expect(body).toBeDefined();
    });

    it('returns 500 when skill tree data cannot be loaded', async () => {
      vi.mocked(auth.getUserId).mockReturnValue('user-1');
      
      // Mock the skill tree lib to throw an error
      const { getSkillTreeVisualization } = await import('@/lib/skill-tree');
      vi.mocked(getSkillTreeVisualization).mockRejectedValueOnce(new Error('Database error'));
      
      const { GET } = await import('@/app/api/skill-tree/route');
      const request = new NextRequest('http://localhost:3000/api/skill-tree');
      const response = await GET(request);
      
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Failed to get skill tree');
    });
  });

  describe('POST /api/skill-tree/quests/[id]/start', () => {
    it('returns 401 when no user ID provided', async () => {
      vi.mocked(auth.getUserId).mockReturnValue(null);
      
      const { POST } = await import('@/app/api/skill-tree/quests/[id]/start/route');
      const request = new NextRequest('http://localhost:3000/api/skill-tree/quests/quest-1/start', {
        method: 'POST',
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'quest-1' }) });
      
      expect(response.status).toBe(401);
    });

    it('returns 200 when quest is started successfully', async () => {
      vi.mocked(auth.getUserId).mockReturnValue('user-1');
      
      const { POST } = await import('@/app/api/skill-tree/quests/[id]/start/route');
      const request = new NextRequest('http://localhost:3000/api/skill-tree/quests/quest-1/start', {
        method: 'POST',
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'quest-1' }) });
      
      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/skill-tree/quests/[id]/complete', () => {
    it('returns 401 when no user ID provided', async () => {
      vi.mocked(auth.getUserId).mockReturnValue(null);
      
      const { POST } = await import('@/app/api/skill-tree/quests/[id]/complete/route');
      const request = new NextRequest('http://localhost:3000/api/skill-tree/quests/quest-1/complete', {
        method: 'POST',
        body: JSON.stringify({ proof: 'Completed the quest' }),
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'quest-1' }) });
      
      expect(response.status).toBe(401);
    });

    it('returns 200 when quest is completed successfully', async () => {
      vi.mocked(auth.getUserId).mockReturnValue('user-1');
      
      const { POST } = await import('@/app/api/skill-tree/quests/[id]/complete/route');
      const request = new NextRequest('http://localhost:3000/api/skill-tree/quests/quest-1/complete', {
        method: 'POST',
        body: JSON.stringify({ proof: 'Completed the quest' }),
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'quest-1' }) });
      
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('xpEarned');
    });
  });

  describe('POST /api/skill-tree/branches/[id]/unlock', () => {
    it('returns 401 when no user ID provided', async () => {
      vi.mocked(auth.getUserId).mockReturnValue(null);
      
      const { POST } = await import('@/app/api/skill-tree/branches/[id]/unlock/route');
      const request = new NextRequest('http://localhost:3000/api/skill-tree/branches/branch-1/unlock', {
        method: 'POST',
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'branch-1' }) });
      
      expect(response.status).toBe(401);
    });

    it('returns 200 when branch is unlocked successfully', async () => {
      vi.mocked(auth.getUserId).mockReturnValue('user-1');
      
      const { POST } = await import('@/app/api/skill-tree/branches/[id]/unlock/route');
      const request = new NextRequest('http://localhost:3000/api/skill-tree/branches/branch-1/unlock', {
        method: 'POST',
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'branch-1' }) });
      
      expect(response.status).toBe(200);
    });
  });
});

describe('Consuela Chat API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/consuela/suggestions', () => {
    it('returns pending suggestions list', async () => {
      const { GET } = await import('@/app/api/consuela/suggestions/route');
      const request = new NextRequest('http://localhost:3000/api/consuela/suggestions');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
    });
  });

  describe('PATCH /api/consuela/suggestions', () => {
    it('returns 401 when no PIN provided', async () => {
      const { PATCH } = await import('@/app/api/consuela/suggestions/route');
      const request = new NextRequest('http://localhost:3000/api/consuela/suggestions', {
        method: 'PATCH',
        body: JSON.stringify({ id: 'test-id', status: 'done' }),
      });
      const response = await PATCH(request);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('pin required');
    });

    it('returns 400 when id or status missing', async () => {
      vi.mocked(auth.getUserId).mockReturnValue('user-1');
      const { PATCH } = await import('@/app/api/consuela/suggestions/route');
      const request = new NextRequest('http://localhost:3000/api/consuela/suggestions', {
        method: 'PATCH',
        headers: { 'x-consuela-pin': '1234' },
        body: JSON.stringify({}),
      });
      const response = await PATCH(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('id + status or snoozedUntil required');
    });
  });
});
