/**
 * GET /api/family-memory
 * Query family memories with filters
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryMemories, getFamilyMemories, getMemoryStats } from '@/lib/family-memory';
import type { MemoryCategory, MemoryQuery } from '@/lib/family-memory';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const userId = searchParams.get('userId') || 'demo-user';
    const familyId = searchParams.get('familyId') || 'demo-family';
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
      userId,
      familyId,
    };

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
      userId || 'demo-user',
      familyId || 'demo-family',
      category || 'note',
      key || content.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 50),
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
