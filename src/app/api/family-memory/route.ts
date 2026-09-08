/**
 * GET /api/family-memory
 * Query family memories with filters
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdminRequest } from '@/lib/admin-auth';
import { MEMORY_USER_ID, MEMORY_FAMILY_ID } from '@/lib/memory-ids';
import { queryMemories, getFamilyMemories, getMemoryStats } from '@/lib/family-memory';
import type { MemoryCategory, MemoryQuery } from '@/lib/family-memory';

// Same [^a-z0-9]+ → _ rule the storeMemory callers use (hermes-tools
// memoryKey + parseRememberCommand) — a client-supplied key is slugged
// server-side so every writer lands in one namespace grammar.
function slugKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 50);
}

export async function GET(request: NextRequest) {
  try {
    // F2 — the memory bank is adults-only: middleware gates /api/** by
    // session only, so the route must parent-gate itself (401/403 like the
    // services routes).
    const auth = await authorizeAdminRequest(request);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    
    // F5 — no 'demo-user' default: without an explicit userId the browser
    // sees the WHOLE family namespace (the agent writes under "consuela").
    const userId = searchParams.get('userId') || undefined;
    const familyId = searchParams.get('familyId') || MEMORY_FAMILY_ID;
    const category = searchParams.get('category') as MemoryCategory | null;
    const search = searchParams.get('search') || undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined;
    const stats = searchParams.get('stats') === 'true';

    // Return stats if requested
    if (stats) {
      const memoryStats = await getMemoryStats(familyId);
      return NextResponse.json({
        success: true,
        stats: memoryStats,
      });
    }

    // Build query
    const query: MemoryQuery = {
      familyId,
    };
    if (userId) query.userId = userId;

    if (category) query.category = category;
    if (search) query.search = search;
    if (limit) query.limit = limit;

    const memories = await queryMemories(query);

    return NextResponse.json({
      success: true,
      memories,
      count: memories.length,
    });
  } catch (error: any) {
    console.error('Failed to query memories:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to query memories' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/family-memory
 * Store a new memory or update existing one
 */

export async function POST(request: NextRequest) {
  try {
    // F2 — adults-only gate (same 401/403 shape as the services routes).
    const auth = await authorizeAdminRequest(request);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const { userId, familyId, category, key, content, tags = [], confidence = 0.8 } = body;

    if (!content) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      );
    }

    const { storeMemory } = await import('@/lib/family-memory');
    
    const memory = await storeMemory(
      // F5 — unqualified adds land in the agent's namespace (the browser's
      // canonical id), not a phantom 'demo-user' row set.
      userId || MEMORY_USER_ID,
      familyId || MEMORY_FAMILY_ID,
      category || 'note',
      // F6.2 — slug client-supplied keys server-side before filtering/storing.
      slugKey(key || content),
      content,
      tags,
      confidence
    );

    if (!memory) {
      return NextResponse.json(
        { error: 'Failed to store memory' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      memory,
      message: 'Memory stored successfully',
    }, { status: 201 });
  } catch (error: any) {
    console.error('Failed to store memory:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to store memory' },
      { status: 500 }
    );
  }
}
