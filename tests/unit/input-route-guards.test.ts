import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { withAdmin } from '@/lib/pb-auth';
import { processEmailForward } from '@/lib/email-forwarding';

vi.mock('@/lib/pb-auth', () => ({
  withAdmin: vi.fn(),
}));

vi.mock('@/lib/email-forwarding', () => ({
  processEmailForward: vi.fn(async () => ({
    success: true,
    subject: 'Test',
    parsed: {},
    clarification: null,
  })),
}));

function jsonRequest(path: string, body: unknown = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('formData route guards', () => {
  it('POST /api/ocr/extract rejects non-multipart requests with 400', async () => {
    const { POST } = await import('@/app/api/ocr/extract/route');
    const response = await POST(jsonRequest('/api/ocr/extract'));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('multipart/form-data');
  });

  it('POST /api/voice/process rejects non-multipart requests with 400', async () => {
    const { POST } = await import('@/app/api/voice/process/route');
    const response = await POST(jsonRequest('/api/voice/process'));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('multipart/form-data');
  });

  it('POST /api/photo/process rejects non-multipart requests with 400', async () => {
    const { POST } = await import('@/app/api/photo/process/route');
    const response = await POST(jsonRequest('/api/photo/process'));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('multipart/form-data');
  });
});

describe('email forward validation', () => {
  it('POST /api/email/forward rejects missing subject/body with 400', async () => {
    const { POST } = await import('@/app/api/email/forward/route');
    const response = await POST(jsonRequest('/api/email/forward'));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Email subject and body are required');
  });

  it('POST /api/email/forward reads members via admin client and tolerates missing saved locations', async () => {
    const collections: string[] = [];
    const fakePB = {
      collection: (name: string) => {
        collections.push(name);
        return {
          getFullList: async () => {
            if (name === 'consuela_saved_locations') throw new Error('collection missing');
            return [];
          },
        };
      },
    };
    vi.mocked(withAdmin).mockImplementation(async (fn: any) => fn(fakePB));

    const { POST } = await import('@/app/api/email/forward/route');
    const response = await POST(
      jsonRequest('/api/email/forward', { subject: 'Soccer practice', body: 'Saturday at 9am' })
    );

    expect(response.status).toBe(200);
    expect(collections).toContain('members');
    expect(collections).not.toContain('users');
    expect(processEmailForward).toHaveBeenCalled();
  });
});
